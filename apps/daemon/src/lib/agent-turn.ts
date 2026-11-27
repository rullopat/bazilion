// Runs a prepared turn (see turn-preparation.ts): builds the daemon hosts behind the worker's
// tools, spawns the worker, relays its frames (mirroring them to Telegram) and ends the turn's
// registration whatever happens.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { imageRoute } from '../core/image-generation-config.ts'
import { agentReviewRepo, commandRuleRepo, mergeSecretsIntoEnv } from '../core/index.ts'
import { hasCredentials, loadAccessToken } from '../runtime/auth/openai-codex.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { rememberLocalModelWindow } from '../runtime/providers/pi-runtime.ts'
import { loadPromptSkills } from '../runtime/session/prompt.ts'
import {
  containerWorkdir,
  jobContainerPrefix,
  removeDockerContainers,
} from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig, toolEnvironment } from '../runtime/shell/security.ts'
import { buildDockerSandbox, SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import type { WorkerHosts } from '../runtime/worker/ipc-protocol.ts'
import { noteTurnEnd, noteTurnFrame } from './activity.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { commandApprovalRegistry, createTurnApprovalHost } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { reviewCommand } from './command-review.ts'
import { getCtx } from './ctx.ts'
import { createImageGenerationHost } from './image-generation.ts'
import { createJobHost } from './jobs.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { questionRegistry } from './questions.ts'
import { createResultHost } from './result-host.ts'
import { agentContacts, createDbTeamHost } from './team-host.ts'
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
    // A tool that sends or changes something outside waits for the operator, as a risky command
    // does: in the chat, Telegram and Attention, and refused when nobody can answer this turn.
    const mcp = await resolveMcpForTurn(db, authToken, turn.controller.signal, (request) =>
      commandApprovalRegistry.begin(
        {
          id: randomUUID(),
          turnId: turn.request.attemptId,
          toolCallId: request.toolCallId,
          agentId,
          teamId: turn.agent.team.id,
          command: request.command,
          risks: [
            {
              code: 'outward-action',
              message: 'It sends or changes something outside Bazilion.',
              span: { start: 0, end: 0 },
            },
          ],
          mode: turn.bashApprovalMode,
          tool: request.tool,
        },
        request.signal ?? turn.controller.signal,
      ),
    )
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
        contacts: agentContacts(db, agentId),
        withOperator: withOperator(turn),
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
      if (frame.kind === 'done') {
        completed = true
        // The worker reports the window Pi was given; seed the daemon's sync reads with it.
        const window = frame.context?.window
        if (typeof window === 'number' && window > 0)
          rememberLocalModelWindow(turn.agent.model, window)
      }
      noteTurnFrame(agentId, frame)
      yield frame
    }
    // Reviewed learning counts the completed turns the owner started.
    if (completed && (turn.request.origin === 'http' || turn.request.origin === 'telegram')) {
      agentReviewRepo.recordSuccessfulUserTurn(db, agentId)
    }
  } finally {
    noteTurnEnd(agentId)
    mirrorTypingStop(agentId)
    // A killed worker cannot remove the container its last command was running in.
    if (turn.docker) await removeDockerContainers(turn.docker.containerPrefix)
    releasePreparedAgentTurn(turn)
  }
}

/** The review model's verdict on a dangerous command, when Commands asks for one and one is chosen. */
function reviewer(turn: PreparedAgentTurn, env: NodeJS.ProcessEnv) {
  const model = env.BAZILION_COMMAND_REVIEW_MODEL?.trim()
  if (resolveShellSecurityConfig(env).approvalMode !== 'review' || !model) return undefined
  const { db, authToken } = getCtx()
  const { agent } = turn
  return (
    input: { command: string; risks: Array<{ code: string; message: string }> },
    signal?: AbortSignal,
  ) =>
    reviewCommand(
      {
        command: input.command,
        risks: input.risks,
        agentName: agent.agent.name,
        workspace: turn.docker ? containerWorkdir(turn.docker.cwd) : agent.team.path,
        sandbox: turn.docker ? 'docker' : 'host',
      },
      { model, db, authToken, env, ...(signal ? { signal } : {}) },
    )
}

/** The operator started the turn: a web or terminal chat, a follow-up queued from one, Telegram. */
function withOperator(turn: PreparedAgentTurn): boolean {
  return turn.request.origin === 'http' || turn.request.origin === 'telegram'
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
    bashApprovalHost: createTurnApprovalHost({
      registry: commandApprovalRegistry,
      rule: (agentId, command) => commandRuleRepo.matching(db, agentId, command)?.prefix ?? null,
      review: reviewer(turn, secretsEnv()),
    }),
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
    // Agents add teammates when the operator asks, never from a schedule or a teammate's message.
    teamHost: withOperator(turn) ? createDbTeamHost(db, paths, agent.agent.id) : undefined,
    // Bound to this turn's Agent: the worker cannot drive another Agent's browser.
    browserHost: isBrowserEnabled(env)
      ? createBrowserHost(resolveBrowserConfig(env), {
          paths,
          agentId: agent.agent.id,
          signal,
          uploadsShown: turn.docker ? SANDBOX_INPUTS_DIR : join(agent.agent.dir, 'uploads'),
        })
      : undefined,
    // Its jobs run where its commands do: in the turn's container, or on the host.
    jobHost: createJobHost({
      paths,
      agentId: agent.agent.id,
      conversationId: conversation.id,
      ...(turn.docker
        ? {
            docker: {
              sandbox: () => {
                const docker = turn.docker
                if (!docker) throw new Error('the turn has no Docker settings')
                return buildDockerSandbox(agent.team.path, docker, {
                  inputsDir: join(agent.agent.dir, 'uploads'),
                  skillMounts: loadPromptSkills(paths.skillsDir, agent.skills).map((skill) => ({
                    source: skill.hostDir,
                    target: skill.sandboxDir,
                  })),
                })
              },
              namePrefix: jobContainerPrefix(paths.home),
            },
          }
        : { host: { cwd: agent.team.path, env } }),
    }),
  }
}
