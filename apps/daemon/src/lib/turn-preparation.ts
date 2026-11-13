// Turn admission: everything a turn needs before its worker starts, so the chat route can still
// answer 4xx before it streams. `prepareAgentTurn` refuses a busy Agent or an unready provider,
// registers the turn for cancellation, resolves its conversation and saves its uploads;
// `runAgentTurn` (agent-turn.ts) then runs it.

import type {
  Attachment,
  BashApprovalMode,
  ConversationTarget,
  ResolvedAgent,
} from '@bazilion/api-types'
import { mergeSecretsIntoEnv, resolveAgent } from '../core/index.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { type DockerTurn, SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import type { RepositoryInstructions } from '../runtime/worker/runtime.ts'
import {
  AgentTurnActiveError,
  isActiveAgent,
  ownsActiveAgent,
  registerAgent,
  unregisterAgent,
} from './agent-cancel.ts'
import { assertProviderReady } from './api-key.ts'
import { saveInputFiles } from './attachments.ts'
import { dockerTurn } from './coding-environment.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { getCtx } from './ctx.ts'
import { loadRepositoryInstructions } from './repository-instructions.ts'

/** The scheduler's registration of a trigger or inbox turn, which preparation takes over. */
interface TurnClaim {
  /** The controller the scheduler registered with `registerAgent`; aborting it cancels the turn. */
  controller: AbortController
}

/** One Agent turn as its origin asks for it. */
export type TurnRequest = {
  /** Correlates the turn in the worker and the logs: request id, queue item, occurrence, inbox batch. */
  attemptId: string
  agentId: string
  /** The conversation delayed work was queued for; otherwise the Agent's selected one. */
  conversationId?: string
  message: string
  attachments: readonly Attachment[]
  /** The peer message an inbox wake answers, carried onto the messages the turn sends. */
  causalParentMessageId?: string | null
} & (
  | {
      /** Web or CLI chat, or a follow-up queued from them. */
      origin: 'http'
      /** 'interactive' only for a foreground client that answers shell approvals. */
      bashApprovalMode: BashApprovalMode
      /** A foreground web or terminal chat that can answer ask_user. Queued follow-ups have none. */
      questionMode?: 'web' | 'tty'
    }
  /** A Telegram message: its topic can answer ask_user. */
  | { origin: 'telegram' }
  /** A scheduled trigger or an inbox wake, already registered by the scheduler. */
  | { origin: 'trigger' | 'inbox'; claim: TurnClaim }
)

/** An admitted, registered turn, ready for `runAgentTurn`. */
export interface PreparedAgentTurn {
  request: TurnRequest
  agent: ResolvedAgent
  conversation: ConversationTarget
  /** The request's message plus a note for each saved upload. */
  message: string
  images: Attachment[]
  /** The turn's Docker settings when BAZILION_BASH_SANDBOX is docker. */
  docker?: DockerTurn
  repositoryInstructions: RepositoryInstructions
  /** The owner is there to answer `ask_user`: a foreground web/CLI chat or a Telegram message. */
  questions: boolean
  /** Unattended origins auto-deny dangerous commands; that is their only difference. */
  bashApprovalMode: BashApprovalMode
  controller: AbortController
}

export async function prepareAgentTurn(request: TurnRequest): Promise<PreparedAgentTurn> {
  const { db, paths, authToken } = getCtx()
  const { agentId } = request
  const claim = 'claim' in request ? request.claim : undefined
  const controller = claim?.controller ?? new AbortController()
  let registered = claim !== undefined
  try {
    // A scheduler turn arrives registered. Any other refuses a busy Agent before it registers,
    // so a waiting Telegram message or follow-up can run later.
    if (!claim && isActiveAgent(agentId)) throw new AgentTurnActiveError(agentId)
    const agent = resolveAgent(db, paths, agentId)
    assertProviderReady(db, authToken, agent.model)
    const conversation = resolveConversationTarget(db, paths, agentId, request.conversationId)
    if (!claim) {
      registerAgent(agentId, controller)
      registered = true
    }

    // One rule for every origin: BAZILION_BASH_SANDBOX picks host or Docker bash.
    const env = mergeSecretsIntoEnv(db, authToken)
    const docker =
      resolveShellSecurityConfig(env).sandboxMode === 'docker'
        ? dockerTurn(db, paths, agent, env)
        : undefined
    const repositoryInstructions = loadRepositoryInstructions(agent.team.path, docker?.cwd ?? '.')
    const images = request.attachments.filter((file) => file.mimeType.startsWith('image/'))
    const documents = request.attachments.filter((file) => !file.mimeType.startsWith('image/'))
    const fileNote = saveInputFiles(
      agent.agent.dir,
      documents,
      docker ? { referenceDir: SANDBOX_INPUTS_DIR } : {},
    )
    return {
      request,
      agent,
      conversation,
      message: [request.message, fileNote].filter(Boolean).join('\n\n'),
      images,
      ...(docker ? { docker } : {}),
      repositoryInstructions,
      questions:
        request.origin === 'telegram' ||
        (request.origin === 'http' && request.questionMode !== undefined),
      bashApprovalMode: request.origin === 'http' ? request.bashApprovalMode : 'auto_deny',
      controller,
    }
  } catch (error) {
    if (registered) unregisterAgent(agentId)
    throw error
  }
}

/** End the turn's registration, unless a later turn of the Agent already holds it. */
export function releasePreparedAgentTurn(turn: PreparedAgentTurn): void {
  if (ownsActiveAgent(turn.agent.agent.id, turn.controller)) unregisterAgent(turn.agent.agent.id)
}
