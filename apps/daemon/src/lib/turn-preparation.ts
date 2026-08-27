import type { Attachment, ResolvedAgent } from '@bazilion/api-types'
import { mergeSecretsIntoEnv, resolveAgent } from '../core/index.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { SANDBOX_INPUTS_DIR } from '../runtime/shell/tooling.ts'
import {
  AgentTurnActiveError,
  isActiveAgent,
  registerAgent,
  unregisterAgent,
} from './agent-cancel.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import { saveInputFiles } from './attachments.ts'
import { authorizeUserIngress } from './communication.ts'
import { getCtx } from './ctx.ts'
import {
  consumePreparedProtectedExecution,
  type PreparedProtectedExecution,
  prepareProtectedExecution,
} from './protected-execution.ts'
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

export interface PrepareAgentTurnInput {
  invocation: TrustedTurnInvocation
  /** Daemon-only inbox readiness result obtained before canonical messages were claimed. */
  protectedExecution?: PreparedProtectedExecution
}

/**
 * A lifecycle-leased, finally-authorized and actively registered turn.
 * Only `prepareAgentTurn` can construct this nominal type.
 */
export interface PreparedAgentTurn {
  readonly [preparedTurnBrand]: true
  readonly agent: ResolvedAgent
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

  try {
    // Scheduler/inbox claims are already this Agent's active registration.
    // Every other source must reject a cross-source active turn before final
    // authorization, so a retained Telegram head can retry without authorizing
    // the same transport attempt twice.
    if (!preclaimed && isActiveAgent(agentId)) {
      throw new AgentTurnActiveError(agentId)
    }
    const agent = resolveAgent(db, paths, agentId)
    if (invocationOwnsUserAuthorization(input.invocation)) {
      const attempt =
        input.invocation.kind === 'operator_http'
          ? (() => {
              const { agentId: _boundAgentId, ...authorization } = input.invocation.authorization
              return {
                ...authorization,
                approvalPayloadKind: 'agent_turn',
                approvalPayload: {
                  agentId,
                  message: inputMessage,
                  attachments: [...attachments],
                },
              }
            })()
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
    const images = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'))
    const documents = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'))
    if (input.protectedExecution) {
      if (surface !== 'protected' || documents.length > 0) {
        throw new Error('preflighted protected execution does not match this turn')
      }
    }
    const protectedExecution =
      input.protectedExecution ??
      (surface === 'protected'
        ? await prepareProtectedExecution(agent, {
            includeUploads: documents.length > 0,
            signal: controller.signal,
          })
        : undefined)
    if (protectedExecution) consumePreparedProtectedExecution(protectedExecution, agent)
    const configuredUsesDocker =
      surface === 'configured_operator_http' &&
      resolveShellSecurityConfig(mergeSecretsIntoEnv(db, authToken)).sandboxMode === 'docker'
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
      [preparedTurnBrand]: true as const,
      agent,
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
    preparedTurns.add(prepared)
    return prepared
  } catch (error) {
    if (registered) unregisterAgent(agentId)
    throw error
  } finally {
    releaseLease()
  }
}

export function releasePreparedAgentTurn(turn: PreparedAgentTurn): void {
  unregisterAgent(turn.agent.agent.id)
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
