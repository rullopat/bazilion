// Runs a prepared turn (see turn-preparation.ts): builds the daemon hosts behind the worker's
// tools, spawns the worker, relays its frames (mirroring them to Telegram) and ends the turn's
// registration whatever happens.

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { imageRoute } from '../core/image-generation-config.ts'
import {
  agentReviewRepo,
  commandRuleRepo,
  mergeSecretsIntoEnv,
  messageRepo,
} from '../core/index.ts'
import { hasCredentials, loadAccessToken } from '../runtime/auth/openai-codex.ts'
import { spawnWorkerTurn } from '../runtime/index.ts'
import { rememberLocalModelWindow } from '../runtime/providers/pi-runtime.ts'
import { isContained, readContainedFile } from '../runtime/safe-files.ts'
import { loadPromptSkills } from '../runtime/session/prompt.ts'
import { ContainerPaths } from '../runtime/shell/container-paths.ts'
import {
  CONTAINER_WORKSPACE,
  containerWorkdir,
  jobContainerPrefix,
  removeDockerContainers,
} from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig, toolEnvironment } from '../runtime/shell/security.ts'
import { buildDockerSandbox, SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import type { WorkerHosts } from '../runtime/worker/ipc-protocol.ts'
import { envSecretValues } from '../runtime/worker/runtime.ts'
import { noteTurnEnd, noteTurnFrame } from './activity.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { commandApprovalRegistry, createTurnApprovalHost } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { reviewCommand } from './command-review.ts'
import { getCtx } from './ctx.ts'
import { createImageGenerationHost, MAX_REFERENCE_BYTES } from './image-generation.ts'
import { createJobHost } from './jobs.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { questionRegistry } from './questions.ts'
import { createRecallHost } from './recall-host.ts'
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
        unreadMessages: messageRepo.unreadCount(db, agentId),
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
  // The container the turn's commands run in, built from what the daemon knows of the turn.
  const sandbox = () => {
    const docker = turn.docker
    if (!docker) throw new Error('the turn has no Docker settings')
    return buildDockerSandbox(agent.team.path, docker, {
      inputsDir: join(agent.agent.dir, 'uploads'),
      skillMounts: loadPromptSkills(paths.skillsDir, agent.skills).map((skill) => ({
        source: skill.hostDir,
        target: skill.sandboxDir,
      })),
    })
  }
  // A path the Agent names, read as its file tools would: container paths in Docker.
  const readAgentFile = (path: string): Buffer => {
    if (!turn.docker) {
      // The workspace and the Agent's uploads only, links resolved, as deliver_file reads.
      const wanted = resolve(agent.team.path, path)
      for (const root of [agent.team.path, join(agent.agent.dir, 'uploads')]) {
        let real: string
        try {
          real = realpathSync(root)
        } catch {
          continue
        }
        if (isContained(root, wanted) || isContained(real, wanted)) {
          return readContainedFile(wanted, real, MAX_REFERENCE_BYTES)
        }
      }
      throw new Error(`${path} is not in your workspace or uploads`)
    }
    const current = sandbox()
    const files = new ContainerPaths([
      { target: CONTAINER_WORKSPACE, source: current.workspace, writable: true },
      ...current.readOnlyMounts.map((mount) => ({ ...mount, writable: false })),
    ])
    return files.readFile(posix.resolve(containerWorkdir(turn.docker.cwd), path))
  }
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
          readReference: readAgentFile,
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
    // recall with everywhere: the Agent's other conversations, read here.
    recallHost: createRecallHost({
      db,
      paths,
      agentId: agent.agent.id,
      conversationId: conversation.id,
      secrets: envSecretValues(secretsEnv()),
    }),
    // Its jobs run where its commands do: in the turn's container, or on the host.
    jobHost: createJobHost({
      paths,
      agentId: agent.agent.id,
      conversationId: conversation.id,
      ...(turn.docker
        ? { docker: { sandbox, namePrefix: jobContainerPrefix(paths.home) } }
        : { host: { cwd: agent.team.path, env } }),
    }),
  }
}
