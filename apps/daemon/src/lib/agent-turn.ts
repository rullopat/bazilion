import type { ChatFrame } from '@bazilion/api-types'
import { agentReviewRepo, mergeSecretsIntoEnv, providerStateRepo } from '../core/index.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { getCtx } from './ctx.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { type LiveQuestionHost, questionServiceFor } from './question-service.ts'
import { createResultHost } from './result-host.ts'
import { authorizeBackgroundResult } from './result-library-delivery.ts'
import { reconcilePrivateResults } from './result-retention.ts'
import { mirrorAgentTurnFrame, mirrorTypingStart, mirrorTypingStop } from './telegram/mirror.ts'
import { invocationRepresentsUserTurn } from './turn-invocation.ts'
import {
  consumePreparedAgentTurn,
  type PreparedAgentTurn,
  prepareAgentTurn,
  releasePreparedAgentTurn,
} from './turn-preparation.ts'
import { createDbUserMdHost } from './user-md-host.ts'

export { prepareAgentTurn }

/**
 * Execute a daemon-prepared turn. There is no raw Agent id, optional origin,
 * implicit authorization, or isolation flag at this boundary: callers must
 * first acquire the branded preparation produced by `prepareAgentTurn`.
 */
export async function* runAgentTurn(turn: PreparedAgentTurn): AsyncGenerator<ChatFrame> {
  consumePreparedAgentTurn(turn)
  const { agent, invocation } = turn
  const turnId = invocation.authorization.attemptId
  let questionHost: LiveQuestionHost | undefined

  try {
    const { db, paths, authToken } = getCtx()
    questionHost = turn.questionRoute
      ? questionServiceFor(db, paths, authToken).attach(turn)
      : undefined
    const messagingHost = createDbMessagingHost(db, {
      causalParentMessageId: turn.causalParentMessageId,
    })
    const userMdHost = createDbUserMdHost(db, paths)
    const resultHost = createResultHost(db, paths, agent, turn.controller.signal, turn.conversation)
    let frames: AsyncGenerator<ChatFrame, void, void>
    if (turn.surface === 'configured_operator_http') {
      if (invocation.kind !== 'operator_http') {
        throw new Error('configured operator surface requires an operator_http invocation')
      }
      const env = mergeSecretsIntoEnv(db, authToken)
      const enabledProviders = Array.from(providerStateRepo.listEnabled(db))
      const { apiKey, refreshApiKey } = await resolveAgentApiKey(db, authToken, agent, {
        withRefresher: true,
      })
      const browserEnabled = isBrowserEnabled(env)
      const browserHost = browserEnabled ? createBrowserHost(resolveBrowserConfig(env)) : undefined
      const mcp = await resolveMcpForTurn(db, env, authToken)
      frames = spawnWorkerTurn(
        {
          kind: 'configured_operator_http',
          agent,
          message: turn.message,
          conversation: turn.conversation,
          enabledProviders,
          apiKey,
          browserEnabled,
          mcpTools: mcp?.tools,
          images: [...turn.images],
          turnId,
          bashApprovalMode: invocation.bashApprovalMode,
          ...(questionHost ? { questionEnabled: true } : {}),
        },
        {
          env,
          signal: turn.controller.signal,
          messagingHost,
          resultHost,
          userMdHost,
          browserHost,
          mcpHost: mcp?.host,
          bashApprovalHost: commandApprovalRegistry,
          ...(questionHost ? { questionHost } : {}),
          apiKeyRefreshHost: refreshApiKey ? { refresh: refreshApiKey } : undefined,
          diagnosticSink: (diagnostic) => {
            console.warn(`[worker ${agent.agent.id}] ${diagnostic}`)
          },
        },
      )
    } else {
      if (!turn.protectedExecution) {
        throw new Error('protected surface requires protected preparation')
      }
      const prepared = turn.protectedExecution
      frames = spawnWorkerTurn(
        {
          kind: 'protected',
          agent,
          message: turn.message,
          conversation: turn.conversation,
          images: [...turn.images],
          turnId,
          bashApprovalMode: 'auto_deny',
          ...(questionHost ? { questionEnabled: true } : {}),
          runtime: prepared.runtime,
          paths: prepared.paths,
          docker: prepared.docker,
          webFetchEnabled: true,
        },
        {
          signal: turn.controller.signal,
          messagingHost,
          resultHost,
          userMdHost,
          bashApprovalHost: commandApprovalRegistry,
          ...(questionHost ? { questionHost } : {}),
          apiKeyRefreshHost: { refresh: prepared.refreshApiKey },
        },
      )
    }

    mirrorTypingStart(agent.agent.id, `${invocation.authorization.attemptKind}:${turnId}:typing`)
    let mirrorFrameIndex = 0
    let completed = false
    for await (const frame of frames) {
      if (invocation.kind !== 'operator_http') {
        authorizeBackgroundResult(db, agent.agent.id, frame)
      }
      void mirrorAgentTurnFrame(
        agent.agent.id,
        frame,
        `${invocation.authorization.attemptKind}:${turnId}:${mirrorFrameIndex++}`,
      ).catch((error) => {
        console.warn(
          JSON.stringify({
            event: 'telegram_mirror_failed',
            agentId: agent.agent.id,
            attemptKind: invocation.authorization.attemptKind,
            attemptId: turnId,
            errorName: error instanceof Error ? error.name : 'unknown',
          }),
        )
      })
      if (frame.kind === 'done') completed = true
      yield frame
    }
    if (completed && invocationRepresentsUserTurn(invocation)) {
      agentReviewRepo.recordSuccessfulUserTurn(db, agent.agent.id)
    }
  } finally {
    questionHost?.close()
    mirrorTypingStop(agent.agent.id)
    releasePreparedAgentTurn(turn)
    reconcilePrivateResults(getCtx().db)
  }
}
