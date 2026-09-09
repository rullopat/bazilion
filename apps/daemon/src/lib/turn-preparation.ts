import type { Attachment, ConversationTarget, ResolvedAgent } from '@bazilion/api-types'
import { mergeSecretsIntoEnv, resolveAgent } from '../core/index.ts'
import { assertSelection } from '../core/repos/conversations.ts'
import * as userQueue from '../core/repos/user-queue.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import {
  AgentTurnActiveError,
  isActiveAgent,
  ownsActiveAgent,
  registerAgent,
  unregisterAgent,
} from './agent-cancel.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import { saveInputFiles } from './attachments.ts'
import { workspaceLifecycle } from './coding-environment/lifecycle.ts'
import { resolveTeamCodingEnvironment } from './coding-environment/resolve.ts'
import type { WorkspaceLease } from './coding-environment/workspace.ts'
import { authorizeUserIngress } from './communication.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { getCtx } from './ctx.ts'
import {
  consumePreparedProtectedExecution,
  type PreparedProtectedExecution,
  prepareAgentDockerInputs,
  prepareProtectedExecution,
} from './protected-execution.ts'
import { type QuestionResponseRoute, resolveQuestionRoute } from './question-route.ts'
import {
  requireCompleteRepositoryContext,
  resolveRepositoryContext,
} from './repository-context/index.ts'
import { requireTelegramQueuedTurn } from './telegram/queue-binding.ts'
import {
  assertTrustedTurnInvocation,
  consumePreclaimedTurn,
  executionSurfaceForInvocation,
  invocationHasPreclaimedRegistration,
  invocationOwnsUserAuthorization,
  type TrustedTurnInvocation,
  type TurnExecutionSurface,
} from './turn-invocation.ts'

const preparedTurnBrand: unique symbol = Symbol('bazilion.prepared-agent-turn')
const preparedTurns = new WeakSet<object>()
const consumedTurns = new WeakSet<object>()
const workspaceLeases = new WeakMap<object, WorkspaceLease>()

export interface PrepareAgentTurnInput {
  /** Daemon scheduler claim acquired before consuming inbox inputs. */
  workspaceLease?: WorkspaceLease
  /** Authenticated foreground client response support; never inherited by queued HTTP work. */
  questionMode?: 'web' | 'tty'
  /** Daemon queue dispatcher reference, verified against the complete invocation below. */
  queuedItemId?: string
  expectedSelection?: import('@bazilion/api-types').ConversationSelection
  invocation: TrustedTurnInvocation
  /** Daemon-only inbox readiness result obtained before canonical messages were claimed. */
  protectedExecution?: PreparedProtectedExecution
}

/**
 * A lifecycle-leased, finally-authorized and actively registered turn.
 * Only `prepareAgentTurn` can construct this nominal type.
 */
export interface PreparedAgentTurn {
  readonly configuredDocker?: Awaited<ReturnType<typeof prepareAgentDockerInputs>>
  readonly repositoryContext: import('@bazilion/api-types').RepositoryContextReport
  readonly questionRoute?: QuestionResponseRoute
  readonly [preparedTurnBrand]: true
  readonly agent: ResolvedAgent
  readonly conversation: ConversationTarget
  readonly message: string
  readonly images: readonly Attachment[]
  readonly invocation: TrustedTurnInvocation
  readonly surface: TurnExecutionSurface
  readonly protectedExecution?: PreparedProtectedExecution
  readonly controller: AbortController
  readonly causalParentMessageId?: string | null
}

/**
 * Own the one final turn-boundary authorization/claim handoff under the Agent
 * lifecycle lease. Callers cannot bypass this with loose booleans.
 */
export async function prepareAgentTurn(input: PrepareAgentTurnInput): Promise<PreparedAgentTurn> {
  assertTrustedTurnInvocation(input.invocation)
  const { agentId, message: inputMessage, attachments } = input.invocation.turn
  const { db, paths, authToken } = getCtx()
  const preclaimedInvocation = invocationHasPreclaimedRegistration(input.invocation)
    ? input.invocation
    : undefined
  // Consumption happens here, after invocation construction and immediately
  // before preparation assumes ownership of the existing registration/lease.
  const preclaimed = preclaimedInvocation ? consumePreclaimedTurn(preclaimedInvocation) : undefined
  const controller = preclaimed?.controller ?? new AbortController()
  const releaseLease = preclaimed?.releaseLease ?? (await acquireAgentLifecycleLease(agentId))
  let registered = preclaimedInvocation !== undefined
  let workspaceLease: WorkspaceLease | undefined

  try {
    // Scheduler/inbox claims are already this Agent's active registration.
    // Every other source must reject a cross-source active turn before final
    // authorization, so a retained Telegram head can retry without authorizing
    // the same transport attempt twice.
    if (!preclaimed && isActiveAgent(agentId)) {
      throw new AgentTurnActiveError(agentId)
    }
    const agent = resolveAgent(db, paths, agentId)
    if (input.workspaceLease) {
      workspaceLifecycle(db).coordinator.assertLease(
        input.workspaceLease,
        agent.team.id,
        agent.team.path,
      )
      workspaceLease = input.workspaceLease
    } else
      workspaceLease = await workspaceLifecycle(db).claim(agent.team.id, agent.team.path, 'agent')
    if (input.expectedSelection) assertSelection(db, agentId, input.expectedSelection)
    const conversation = resolveConversationTarget(
      db,
      paths,
      agentId,
      input.invocation.turn.conversationId,
    )
    let queuedReference: ReturnType<typeof userQueue.approvalReference> | undefined
    if (input.queuedItemId) {
      const retained = userQueue.readInput(db, agentId, input.queuedItemId)
      if (
        !(
          (input.invocation.kind === 'operator_http' && retained.item.source === 'http') ||
          (input.invocation.kind === 'telegram' && retained.item.source === 'telegram')
        ) ||
        retained.item.status !== 'claimed' ||
        agent.agent.status === 'archived' ||
        retained.item.teamId !== agent.team.id ||
        retained.item.conversationId !== conversation.id ||
        retained.item.text !== inputMessage ||
        retained.item.attemptId !== input.invocation.authorization.attemptId ||
        JSON.stringify(retained.attachments) !== JSON.stringify(attachments) ||
        userQueue.control(db, agentId).paused
      )
        throw new Error('Queued turn binding changed')
      if (input.invocation.kind === 'telegram') {
        const binding = requireTelegramQueuedTurn(
          db,
          authToken,
          retained.provenance,
          input.invocation.turn,
        )
        if (
          JSON.stringify(binding.authorization) !== JSON.stringify(input.invocation.authorization)
        )
          throw new Error('Queued Telegram authorization changed')
      }
      queuedReference = userQueue.approvalReference(db, agentId, input.queuedItemId)
    }
    if (invocationOwnsUserAuthorization(input.invocation)) {
      const attempt =
        input.invocation.kind === 'operator_http'
          ? (() => {
              const { agentId: _boundAgentId, ...authorization } = input.invocation.authorization
              return {
                ...authorization,
                approvalPayloadKind: queuedReference ? 'queued_user' : 'agent_turn',
                approvalPayload: queuedReference ?? {
                  agentId,
                  conversationId: conversation.id,
                  message: inputMessage,
                  attachments: [...attachments],
                },
              }
            })()
          : queuedReference
            ? {
                ...input.invocation.authorization,
                approvalPayloadKind: 'queued_user',
                approvalPayload: queuedReference,
              }
            : input.invocation.authorization
      authorizeUserIngress(db, agentId, attempt, () => {
        registerAgent(agentId, controller)
        registered = true
      })
    } else if (!preclaimedInvocation) {
      // Approval delivery was revalidated transactionally by the approval
      // repository. Preparation owns only lifecycle registration here.
      registerAgent(agentId, controller)
      registered = true
    }

    const surface = executionSurfaceForInvocation(input.invocation)
    const questionRoute = resolveQuestionRoute(
      db,
      authToken,
      input.invocation,
      input.questionMode,
      input.queuedItemId,
    )
    const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
    const documents = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
    if (input.protectedExecution) {
      if (surface !== 'protected' || documents.length > 0) {
        throw new Error('preflighted protected execution does not match this turn')
      }
    }
    const mergedEnv = mergeSecretsIntoEnv(db, authToken)
    const usesDocker =
      surface === 'protected' || resolveShellSecurityConfig(mergedEnv).sandboxMode === 'docker'
    const selectedCoding = usesDocker
      ? resolveTeamCodingEnvironment(db, agent.team.id, mergedEnv).coding
      : undefined
    const repositoryContext = await resolveRepositoryContext({
      teamId: agent.team.id,
      root: agent.team.path,
      target: selectedCoding?.cwd ?? '.',
    })
    requireCompleteRepositoryContext(repositoryContext)
    const protectedExecution =
      input.protectedExecution ??
      (surface === 'protected'
        ? await prepareProtectedExecution(agent, {
            includeUploads: documents.length > 0,
            signal: controller.signal,
            dockerLifecycle: workspaceLifecycle(db).containers(workspaceLease),
          })
        : undefined)
    if (protectedExecution) consumePreparedProtectedExecution(protectedExecution, agent)
    const configuredUsesDocker =
      surface === 'configured_operator_http' &&
      resolveShellSecurityConfig(mergeSecretsIntoEnv(db, authToken)).sandboxMode === 'docker'
    const configuredDocker = configuredUsesDocker
      ? await prepareAgentDockerInputs(agent, {
          includeUploads: documents.length > 0,
          signal: controller.signal,
          dockerLifecycle: workspaceLifecycle(db).containers(workspaceLease),
        })
      : undefined
    const fileNote = saveInputFiles(
      agent.agent.dir,
      documents,
      surface === 'protected' || configuredUsesDocker
        ? {
            referenceDir: SANDBOX_INPUTS_DIR,
            ...(protectedExecution?.paths.uploadsDir
              ? { storageDir: protectedExecution.paths.uploadsDir }
              : {}),
          }
        : {},
    )
    const message = fileNote
      ? inputMessage
        ? `${inputMessage}\n\n${fileNote}`
        : fileNote
      : inputMessage
    const prepared = {
      ...(questionRoute ? { questionRoute } : {}),
      [preparedTurnBrand]: true as const,
      agent,
      conversation,
      repositoryContext,
      ...(configuredDocker ? { configuredDocker } : {}),
      message,
      images,
      invocation: input.invocation,
      surface,
      ...(protectedExecution ? { protectedExecution } : {}),
      controller,
      ...(input.invocation.turn.causalParentMessageId !== undefined
        ? { causalParentMessageId: input.invocation.turn.causalParentMessageId }
        : {}),
    }
    Object.defineProperty(prepared, preparedTurnBrand, { enumerable: false })
    deepFreezePreparedTurn(prepared)
    workspaceLeases.set(prepared, workspaceLease)
    preparedTurns.add(prepared)
    return prepared
  } catch (error) {
    if (workspaceLease) await workspaceLifecycle(db).release(workspaceLease)
    if (registered) unregisterAgent(agentId)
    throw error
  } finally {
    releaseLease()
  }
}

export function preparedContainerLease(turn: PreparedAgentTurn): WorkspaceLease {
  const lease = workspaceLeases.get(turn)
  if (!lease) throw new Error('Prepared workspace ownership is unavailable')
  return lease
}

export function preparedWorkerLifecycle(turn: PreparedAgentTurn) {
  const lease = workspaceLeases.get(turn)
  if (!lease) throw new Error('Prepared workspace ownership is unavailable')
  return workspaceLifecycle(getCtx().db).worker(lease)
}

export async function releasePreparedAgentTurn(turn: PreparedAgentTurn): Promise<void> {
  const lease = workspaceLeases.get(turn)
  if (lease) {
    workspaceLeases.delete(turn)
    await workspaceLifecycle(getCtx().db).release(lease)
  }
  if (ownsActiveAgent(turn.agent.agent.id, turn.controller)) unregisterAgent(turn.agent.agent.id)
}

export function assertPreparedAgentTurn(value: unknown): asserts value is PreparedAgentTurn {
  if (
    typeof value !== 'object' ||
    value === null ||
    !preparedTurns.has(value) ||
    (value as Partial<PreparedAgentTurn>)[preparedTurnBrand] !== true
  ) {
    throw new Error('Agent turn was not prepared by the trusted daemon boundary')
  }
}

/** Consume the authorization/preflight result exactly once at execution start. */
export function consumePreparedAgentTurn(value: unknown): asserts value is PreparedAgentTurn {
  assertPreparedAgentTurn(value)
  if (consumedTurns.has(value)) {
    throw new Error('prepared Agent turn has already been executed')
  }
  consumedTurns.add(value)
}

function deepFreezePreparedTurn(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null || value instanceof AbortController) return
  if (seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) deepFreezePreparedTurn(child, seen)
  Object.freeze(value)
}
