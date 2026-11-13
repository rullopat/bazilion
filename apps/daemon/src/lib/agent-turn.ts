// Runs a prepared turn (see turn-preparation.ts): builds the daemon hosts behind the worker's
// tools, spawns the worker, relays its frames (mirroring them to Telegram) and ends the turn's
// registration whatever happens.

import type { ChatFrame } from '@bazilion/api-types'
import { imageRoute } from '../core/image-generation-config.ts'
import { agentReviewRepo, mergeSecretsIntoEnv } from '../core/index.ts'
import { hasCredentials, loadAccessToken } from '../runtime/auth/openai-codex.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { removeDockerContainers } from '../runtime/shell/docker.ts'
import { toolEnvironment } from '../runtime/shell/security.ts'
import type { WorkerHosts } from '../runtime/worker/ipc-protocol.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { getCtx } from './ctx.ts'
import { createImageGenerationHost } from './image-generation.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { questionRegistry } from './questions.ts'
import { createResultHost } from './result-host.ts'
import { mirrorAgentTurnFrame, mirrorTypingStart, mirrorTypingStop } from './telegram/mirror.ts'
import {
  type PreparedAgentTurn,
  prepareAgentTurn,
  releasePreparedAgentTurn,
} from './turn-preparation.ts'
import { createDbUserMdHost } from './user-md-host.ts'
import { createWebSearchHost, searchRoute } from './web-search.ts'

export { prepareAgentTurn }

export async function* runAgentTurn(turn: PreparedAgentTurn): AsyncGenerator<ChatFrame> {
  const agentId = turn.agent.agent.id
  try {
    const { db, authToken } = getCtx()
    // The worker, and so every shell command of the turn, never sees Bazilion's own credentials.
    const env = toolEnvironment(mergeSecretsIntoEnv(db, authToken), authToken)
    const { apiKey, refreshApiKey } = await resolveAgentApiKey(db, authToken, turn.agent)
    const mcp = await resolveMcpForTurn(db, authToken, turn.controller.signal)
    const frames = spawnWorkerTurn(
      {
        kind: 'agent_turn',
        agent: turn.agent,
        conversation: turn.conversation,
        message: turn.message,
        images: turn.images,
        apiKey,
        ...(turn.docker ? { docker: turn.docker } : {}),
        repositoryInstructions: turn.repositoryInstructions,
        mcpTools: mcp?.tools,
        turnId: turn.request.attemptId,
        bashApprovalMode: turn.bashApprovalMode,
      },
      {
        env,
        signal: turn.controller.signal,
        diagnosticSink: (diagnostic) => console.warn(`[worker ${agentId}] ${diagnostic}`),
        ...turnHosts(turn, env),
        mcpHost: mcp?.host,
        apiKeyRefreshHost: refreshApiKey ? { refresh: refreshApiKey } : undefined,
      },
    )

    mirrorTypingStart(agentId)
    let completed = false
    for await (const frame of frames) {
      void mirrorAgentTurnFrame(agentId, frame).catch((error) => {
        console.warn(
          JSON.stringify({
            event: 'telegram_mirror_failed',
            agentId,
            origin: turn.request.origin,
            attemptId: turn.request.attemptId,
            errorName: error instanceof Error ? error.name : 'unknown',
          }),
        )
      })
      if (frame.kind === 'done') completed = true
      yield frame
    }
    // Reviewed learning counts the completed turns the owner started.
    if (completed && (turn.request.origin === 'http' || turn.request.origin === 'telegram')) {
      agentReviewRepo.recordSuccessfulUserTurn(db, agentId)
    }
  } finally {
    mirrorTypingStop(agentId)
    // A killed worker cannot remove the container its last command was running in.
    if (turn.docker) await removeDockerContainers(turn.docker.containerPrefix)
    releasePreparedAgentTurn(turn)
  }
}

/** The daemon side of the turn's tools, each bound to this turn's Agent, conversation and signal. */
function turnHosts(turn: PreparedAgentTurn, env: NodeJS.ProcessEnv): WorkerHosts {
  const { db, paths, authToken } = getCtx()
  const { agent, conversation } = turn
  const { signal } = turn.controller
  const secretsEnv = () => mergeSecretsIntoEnv(db, authToken)
  const codexConnected = hasCredentials(db, authToken)
  const search = searchRoute(env, agent.model, codexConnected)
  return {
    messagingHost: createDbMessagingHost(db, {
      causalParentMessageId: turn.request.causalParentMessageId,
    }),
    userMdHost: createDbUserMdHost(db, paths),
    resultHost: createResultHost(db, agent, conversation.id, signal),
    bashApprovalHost: commandApprovalRegistry,
    // ask_user waits for the owner, so only turns the owner can answer get it.
    questionHost: turn.questions
      ? {
          ask: (question, askSignal) =>
            questionRegistry.ask(
              { agentId: agent.agent.id, conversationId: conversation.id },
              question,
              askSignal,
            ),
        }
      : undefined,
    imageGenerationHost: imageRoute(env, codexConnected).ready
      ? createImageGenerationHost({
          db,
          agentId: agent.agent.id,
          teamId: agent.team.id,
          conversationId: conversation.id,
          signal,
          env: secretsEnv,
          codex: {
            connected: () => hasCredentials(db, authToken),
            accessToken: () => loadAccessToken(db, authToken),
          },
        })
      : undefined,
    webSearchHost: search.backend
      ? createWebSearchHost({
          backend: search.backend,
          env: secretsEnv,
          model: agent.model,
          codexToken: () => loadAccessToken(db, authToken),
          signal,
        })
      : undefined,
    // Bound to this turn's Agent: the worker cannot drive another Agent's browser.
    browserHost: isBrowserEnabled(env)
      ? createBrowserHost(resolveBrowserConfig(env), { paths, agentId: agent.agent.id, signal })
      : undefined,
  }
}
