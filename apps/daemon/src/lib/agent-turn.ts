// Runs a prepared turn (see turn-preparation.ts): builds the daemon hosts behind the worker's
// tools, spawns the worker, relays its frames (mirroring them to Telegram) and ends the turn's
// registration whatever happens.

import { randomUUID } from 'node:crypto'
import { join, posix } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { agentSecretValues, listAgentSecrets } from '../core/agent-secrets.ts'
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
import { readFromRoots } from '../runtime/safe-files.ts'
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
import { MAX_PICTURE_BYTES } from '../runtime/tools/pictures.ts'
import type { WorkerHosts } from '../runtime/worker/ipc-protocol.ts'
import { envSecretValues } from '../runtime/worker/runtime.ts'
import { noteTurnEnd, noteTurnFrame } from './activity.ts'
import { requestAgentSecret } from './agent-secrets.ts'
import { resolveAgentApiKey } from './api-key.ts'
import { commandApprovalRegistry, createTurnApprovalHost } from './bash-approval.ts'
import { isBrowserEnabled, resolveBrowserConfig } from './browser/config.ts'
import { createBrowserHost } from './browser/host.ts'
import { reviewCommand } from './command-review.ts'
import { getCtx } from './ctx.ts'
import { createHelperHost, turnClosed, turnOpened } from './helpers.ts'
import { createImageGenerationHost } from './image-generation.ts'
import { createJobHost } from './jobs.ts'
import { resolveMcpForTurn } from './mcp/resolve.ts'
import { createDbMessagingHost } from './messaging-host.ts'
import { questionRegistry } from './questions.ts'
import { createRecallHost } from './recall-host.ts'
import { createResultHost } from './result-host.ts'
import { createScheduleHost } from './schedule-host.ts'
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
  // A helper runs beside the Agent's own turn: it is not the Agent's running turn, in the panel or
  // on Telegram, and its own frames go to the helper's record (lib/helpers.ts).
  const helper = turn.request.origin === 'helper'
  if (!helper) turnOpened(turn.request.attemptId)
  try {
    const { db, authToken } = getCtx()
    // The worker, and so every shell command of the turn, never sees Bazilion's own credentials.
    const env = toolEnvironment(mergeSecretsIntoEnv(db, authToken), authToken)
    // The Agent's own secrets join the worker's environment, and so its commands', by name.
    const secrets = agentSecretValues(db, authToken, agentId)
    const secretEnv = Object.fromEntries(secrets.map((secret) => [secret.name, secret.value]))
    const { apiKey, refreshApiKey } = await resolveAgentApiKey(db, authToken, turn.agent)
    // A tool that sends or changes something outside waits for the operator, as a risky command
    // does: in the chat, Telegram and Attention, and refused when nobody can answer this turn.
    const mcp = await resolveMcpForTurn(
      db,
      authToken,
      turn.controller.signal,
      (request) =>
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
      // Files a tool returns go with the uploads, where the Agent reads them (/inputs in Docker).
      {
        dir: join(turn.agent.agent.dir, 'uploads'),
        shown: turn.docker ? SANDBOX_INPUTS_DIR : join(turn.agent.agent.dir, 'uploads'),
      },
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
        secrets: secrets.map(({ name, hosts }) => ({ name, hosts })),
      },
      {
        env: { ...env, ...secretEnv },
        signal: turn.controller.signal,
        diagnosticSink: (diagnostic) => console.warn(`[worker ${agentId}] ${diagnostic}`),
        ...turnHosts(turn, env, secretEnv),
        mcpHost: mcp?.host,
        apiKeyRefreshHost: refreshApiKey ? { refresh: refreshApiKey } : undefined,
      },
    )

    if (!helper) mirrorTypingStart(agentId)
    let completed = false
    for await (const frame of frames) {
      if (!helper)
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
      if (!helper) noteTurnFrame(agentId, frame)
      yield frame
    }
    // Reviewed learning counts the completed turns the owner started.
    if (completed && (turn.request.origin === 'http' || turn.request.origin === 'telegram')) {
      agentReviewRepo.recordSuccessfulUserTurn(db, agentId)
    }
  } finally {
    if (!helper) {
      noteTurnEnd(agentId)
      mirrorTypingStop(agentId)
      turnClosed(turn.request.attemptId)
    }
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
function turnHosts(
  turn: PreparedAgentTurn,
  env: NodeJS.ProcessEnv,
  secretEnv: Readonly<Record<string, string>>,
): WorkerHosts {
  const { db, paths, authToken } = getCtx()
  const { agent, conversation } = turn
  const { signal } = turn.controller
  // What a helper delivers or schedules belongs to the conversation it was started from.
  const helperOf = turn.request.origin === 'helper' ? turn.request.helper : undefined
  const homeConversation = helperOf?.parentConversationId ?? conversation.id
  const secretsEnv = () => mergeSecretsIntoEnv(db, authToken)
  // The container the turn's commands run in, built from what the daemon knows of the turn.
  const sandbox = () => {
    const docker = turn.docker
    if (!docker) throw new Error('the turn has no Docker settings')
    return buildDockerSandbox(agent.team.path, docker, {
      inputsDir: join(agent.agent.dir, 'uploads'),
      secretEnv,
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
      return readFromRoots(
        path,
        [agent.team.path, join(agent.agent.dir, 'uploads')],
        agent.team.path,
        MAX_PICTURE_BYTES,
      )
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
    resultHost: createResultHost(db, agent, homeConversation, signal),
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
          askSecret: (secret, replace) =>
            requestAgentSecret(db, authToken, {
              agentId: agent.agent.id,
              conversationId: conversation.id,
              secret,
              replace,
            }),
        }
      : undefined,
    secretHost: { list: async () => listAgentSecrets(db, authToken, agent.agent.id) },
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
    // Its schedules: what it adds runs in this conversation, in any kind of turn.
    scheduleHost: createScheduleHost({
      db,
      agentId: agent.agent.id,
      conversationId: homeConversation,
    }),
    // Helpers start helpers of their own never: that is a rule, not a depth limit.
    helperHost: helperOf
      ? undefined
      : createHelperHost({
          db,
          paths,
          agentId: agent.agent.id,
          conversationId: conversation.id,
          turnId: turn.request.attemptId,
          signal,
        }),
    // Its jobs run where its commands do: in the turn's container, or on the host.
    jobHost: createJobHost({
      paths,
      agentId: agent.agent.id,
      conversationId: conversation.id,
      ...(turn.docker
        ? { docker: { sandbox, namePrefix: jobContainerPrefix(paths.home) } }
        : { host: { cwd: agent.team.path, env: { ...env, ...secretEnv } } }),
    }),
  }
}
