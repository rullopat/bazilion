import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getVerificationRequestById } from '../../core/repos/verification-requests.ts'
import type { SpecialistVerificationWorkerSpec } from '../../runtime/worker/runtime.ts'
import type { WorkerResourceLifecycle } from '../../runtime/worker/spawn.ts'
import { ownsActiveAgent } from '../agent-cancel.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import type { WorkspaceLease } from '../coding-environment/workspace.ts'
import { requireTeam } from '../git-review/service.ts'

/** Parent-only ownership, not a lifecycle invocation, tool host or serialized worker capability. */
export interface VerificationWorkerOwnership {
  readonly kind: 'verification-worker-ownership'
}
interface Ownership {
  readonly agentId: string
  readonly requestId: string
  readonly attemptId: string
  readonly lifecycle: WorkerResourceLifecycle
  validate(): void
  consumed: boolean
}
type Binding = Pick<
  SpecialistVerificationWorkerSpec,
  'kind' | 'agentId' | 'turnId' | 'verification'
>
const ownerships = new WeakMap<object, Ownership>()
const unavailable = () => new Error('Verification worker ownership is unavailable')
export function createVerificationWorkerOwnership(input: {
  db: BazilionDb
  paths: Paths
  requestId: string
  attemptId: string
  leaseOwner: string
  lease: WorkspaceLease
  controller: AbortController
  assertSelection?: () => void
}): VerificationWorkerOwnership {
  const options = Object.freeze({ ...input })
  const request = getVerificationRequestById(options.db, options.requestId)
  if (request?.environment.sandbox !== 'native' || !options.leaseOwner) throw unavailable()
  const services = workspaceLifecycle(options.db)
  const validate = () => {
    options.controller.signal.throwIfAborted()
    options.assertSelection?.()
    const actor = getAgent(options.db, request.recipientAgentId)
    if (
      !actor ||
      actor.teamId !== request.teamId ||
      actor.status === 'archived' ||
      !ownsActiveAgent(actor.id, options.controller)
    )
      throw unavailable()
    services.coordinator.assertActiveLease(
      options.lease,
      request.teamId,
      requireTeam(options.db, options.paths, request.teamId).path,
    )
    const attempt = options.db.raw
      .query<
        {
          request_id: string
          lease_owner: string | null
          lease_expires_at: number | null
          finished_at: number | null
        },
        [string]
      >(
        'SELECT request_id,lease_owner,lease_expires_at,finished_at FROM verification_attempts WHERE id=?',
      )
      .get(options.attemptId)
    if (
      !attempt ||
      attempt.request_id !== request.id ||
      attempt.lease_owner !== options.leaseOwner ||
      attempt.finished_at !== null ||
      (attempt.lease_expires_at ?? 0) <= Date.now()
    )
      throw unavailable()
  }
  validate()
  const raw = services.nativeWorker(options.lease)
  const lifecycle: WorkerResourceLifecycle = {
    beforeSpawn() {
      validate()
      raw.beforeSpawn?.()
    },
    // Cleanup authority remains the original live ChildProcess/birth, not the finished attempt.
    beforeSignal() {
      raw.beforeSignal?.()
    },
    ...(raw.signal ? { signal: (signal: 'SIGTERM' | 'SIGKILL') => raw.signal?.(signal) } : {}),
    beforeInput(pid, hostCommands, child) {
      validate()
      if (hostCommands !== false) throw unavailable()
      raw.beforeInput(pid, false, child)
    },
    afterExit: (observed) => raw.afterExit(observed),
  }
  const token: VerificationWorkerOwnership = Object.freeze({
    kind: 'verification-worker-ownership',
  })
  ownerships.set(token, {
    agentId: request.recipientAgentId,
    requestId: request.id,
    attemptId: options.attemptId,
    lifecycle,
    validate,
    consumed: false,
  })
  return token
}
export function assertVerificationWorkerOwnership(
  value: unknown,
  spec: Binding,
): asserts value is VerificationWorkerOwnership {
  if (!value || typeof value !== 'object') throw unavailable()
  const owner = ownerships.get(value)
  if (
    !owner ||
    owner.consumed ||
    spec.kind !== 'specialist_verification' ||
    spec.agentId !== owner.agentId ||
    spec.turnId !== owner.attemptId ||
    spec.verification.requestId !== owner.requestId ||
    spec.verification.attemptId !== owner.attemptId
  )
    throw unavailable()
  owner.validate()
}
/** One input handoff. Raw resourceLifecycle remains forbidden on every restricted spawn. */
export function consumeVerificationWorkerOwnership(
  value: unknown,
  spec: Binding,
): WorkerResourceLifecycle {
  assertVerificationWorkerOwnership(value, spec)
  const owner = ownerships.get(value)
  if (!owner) throw unavailable()
  owner.consumed = true
  return owner.lifecycle
}
