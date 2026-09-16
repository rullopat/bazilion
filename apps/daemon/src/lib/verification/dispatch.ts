import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  getVerificationRequest,
  getVerificationRequestById,
  listVerificationAttempts,
  pruneVerificationRequests,
} from '../../core/repos/verification-requests.ts'
import { mergeSecretsIntoEnv } from '../../core/secrets.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from '../agent-cancel.ts'
import { acquireAgentLifecycleLease } from '../agent-lifecycle-lease.ts'
import { codingSecrets } from '../coding-environment/diagnostics.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { getCtx } from '../ctx.ts'
import { readSnapshotApplicability } from '../git-review/service.ts'
import { protectedFailureMessage } from '../protected-failure.ts'
import {
  admitVerificationRequest,
  VERIFICATION_DISPATCH_OWNER,
  type VerificationAdmission,
} from './admission.ts'
import { createProtectedCheckExecutor } from './executor.ts'
import {
  bindVerificationCapability,
  executePreparedVerification,
  prepareVerificationTurn,
} from './preparation.ts'
import { deliverVerificationResult } from './result.ts'
import {
  abandonVerificationAttempt,
  createVerificationHost,
  settleVerificationAttempt,
} from './runner.ts'
import { compareWorkspaceFingerprints, fingerprintWorkspace } from './writes.ts'

// BAZ-044: the one dispatch owner for a verification request.
//
// Ordering mirrors the restricted review dispatcher: refuse early while the Agent is busy, hold the
// agent lifecycle lease across admission, then release the coder's workspace claim before the
// specialist takes the workspace. Nothing here streams to a client: frames are drained, and the
// request's outcome is settled from the executor-owned check outcomes rather than from anything the
// model said.

const DISPATCH_REGISTRY_KEY = Symbol.for('bazilion.verification.dispatch')

interface DispatchRegistry {
  controllers: Map<string, AbortController>
}

/** Pin one registry per process, like the daemon's other process-lifetime registries. */
function dispatchRegistry(): DispatchRegistry {
  const host = globalThis as unknown as Record<symbol, DispatchRegistry | undefined>
  host[DISPATCH_REGISTRY_KEY] ??= { controllers: new Map() }
  return host[DISPATCH_REGISTRY_KEY] as DispatchRegistry
}

/**
 * Abort the turn running on behalf of one request.
 *
 * Keyed by request id on purpose: cancelling by agent id would abort whatever else that specialist
 * happens to be doing, which is not what "cancel this verification" means.
 */
export function cancelVerificationDispatch(requestId: string): boolean {
  const controller = dispatchRegistry().controllers.get(requestId)
  if (!controller) return false
  controller.abort()
  return true
}

/** Whether this process currently owns a running turn for the request. */
export function isVerificationDispatching(requestId: string): boolean {
  return dispatchRegistry().controllers.has(requestId)
}

export type VerificationDispatchResult =
  | 'dispatched'
  | 'not_dispatchable'
  | 'agent_busy'
  | 'settled'

/** Dispatch one request if it is eligible. Safe to call repeatedly: a claim has one owner. */
export async function dispatchVerificationRequest(
  requestId: string,
  opts: { signal?: AbortSignal; workerEntryPath?: string } = {},
): Promise<VerificationDispatchResult> {
  const { db, paths } = getCtx()
  const request = getVerificationRequestById(db, requestId)
  if (!request) return 'not_dispatchable'
  if (isActiveAgent(request.recipientAgentId)) return 'agent_busy'

  const releaseLease = await acquireAgentLifecycleLease(request.recipientAgentId)
  const controller = new AbortController()
  let registered = false
  try {
    // Re-check under the lease: another turn may have started while we waited for it.
    if (isActiveAgent(request.recipientAgentId)) return 'agent_busy'
    registerAgent(request.recipientAgentId, controller)
    registered = true
  } finally {
    releaseLease()
  }
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true })

  dispatchRegistry().controllers.set(requestId, controller)

  let admission: VerificationAdmission | undefined
  try {
    admission = await admitVerificationRequest(db, paths, requestId)
    if (admission.kind !== 'admitted') return 'not_dispatchable'
    const admitted = admission

    const live = getVerificationRequest(db, request.teamId, requestId)
    if (!live) {
      // The window closed between admission and execution. Settle honestly and release everything.
      await workspaceLifecycle(db).release(admitted.workspace)
      settleVerificationAttempt(db, {
        attemptId: admitted.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
      })
      return 'settled'
    }

    // The baseline is taken here, under the held lease and after admission proved the tree matches the
    // capture, so "where did the checks write" is a comparison of one attempt rather than of the
    // repository's history.
    const writeBaseline = await fingerprintWorkspace(paths.teamDir(live.teamId)).catch(() => null)

    const prepared = await prepareVerificationTurn({
      request: live,
      attemptId: admitted.claim.attempt.id,
    })
    const capability = bindVerificationCapability(
      createVerificationHost({
        db,
        request: live,
        attemptId: admitted.claim.attempt.id,
        applicability: 'identical',
        executor: createProtectedCheckExecutor({
          db,
          paths,
          request: live,
          attemptId: admitted.claim.attempt.id,
          teamPath: paths.teamDir(live.teamId),
          secrets: () => currentSecrets(),
          signal: controller.signal,
          // The checks run while this dispatch holds the workspace lease, so their containers register
          // against it and are reconciled rather than leaked if the daemon dies mid-check.
          containerLifecycle: workspaceLifecycle(db).containers(admitted.workspace),
        }),
      }),
      { requestId, attemptId: admitted.claim.attempt.id },
    )

    let failure: string | null = null
    for await (const frame of executePreparedVerification(prepared, {
      verificationHost: capability,
      signal: controller.signal,
      ...(opts.workerEntryPath ? { workerEntryPath: opts.workerEntryPath } : {}),
    })) {
      if (frame.kind === 'fatal') failure ??= frame.error
      else if (frame.kind === 'event' && frame.event.type === 'error') failure ??= frame.event.error
    }

    if (controller.signal.aborted) {
      const abandoned = abandonVerificationAttempt(db, {
        attemptId: admitted.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
        state: 'cancelled',
        error: 'verification was cancelled before it reported',
      })
      if (abandoned) await handBackResult(db, paths, requestId, 'cancelled')
      return 'settled'
    }
    if (failure) {
      // The turn itself failed. Checks it did not run stay unrun, and the attempt says why — an
      // attempt that reports no outcome is never presented as a result about the change.
      const abandoned = abandonVerificationAttempt(db, {
        attemptId: admitted.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
        state: 'failed',
        error: failure,
      })
      if (abandoned) await handBackResult(db, paths, requestId, 'failed')
      return 'settled'
    }
    // Established while the workspace lease is still held and before the attempt settles, so the
    // evidence and the outcome land together rather than the outcome existing without it.
    const observedWrites = compareWorkspaceFingerprints(
      live,
      writeBaseline,
      await fingerprintWorkspace(paths.teamDir(live.teamId)).catch(() => null),
    )
    const settled = settleVerificationAttempt(db, {
      attemptId: admitted.claim.attempt.id,
      requestId,
      leaseOwner: VERIFICATION_DISPATCH_OWNER,
      observedWrites,
    })
    if (settled !== 'uncertain') await handBackResult(db, paths, requestId, settled)
    return 'dispatched'
  } catch (error) {
    if (admission?.kind === 'admitted') {
      abandonVerificationAttempt(db, {
        attemptId: admission.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
        state: controller.signal.aborted ? 'cancelled' : 'failed',
        error: protectedFailureMessage(error, 'Verification'),
      })
    }
    return 'settled'
  } finally {
    // The workspace claim is released only after the attempt is settled, so a cancelled or failed
    // verification can never leave the Team blocked.
    if (admission?.kind === 'admitted') await workspaceLifecycle(db).release(admission.workspace)
    dispatchRegistry().controllers.delete(requestId)
    if (registered) unregisterAgent(request.recipientAgentId)
  }
}

/**
 * Hand a settled outcome back to the requesting Agent, with the applicability *now*.
 *
 * One place, so every settlement path reports through the same channel — and a delivery that policy
 * refuses never changes the verification's own outcome.
 */
async function handBackResult(
  db: BazilionDb,
  paths: Paths,
  requestId: string,
  outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain',
): Promise<void> {
  const request = getVerificationRequestById(db, requestId)
  if (!request) return
  const attempt = listVerificationAttempts(db, requestId).at(-1)
  if (!attempt) return
  let applicability: 'identical' | 'changed' | 'unknown' | null = null
  try {
    const comparison = await readSnapshotApplicability(
      db,
      paths,
      request.teamId,
      request.snapshotId,
    )
    applicability = comparison.comparison
  } catch {
    // Establishing applicability is evidence, never a reason to withhold the outcome.
    applicability = null
  }
  deliverVerificationResult({ db, paths, request, attempt, outcome, applicability })
}

/** Dispatch every eligible pending request. */
export async function dispatchPendingVerifications(now = Date.now()): Promise<void> {
  const { db, paths } = getCtx()
  // Retention: reads already refuse a request past its window, but nothing deleted the rows. The tick
  // that dispatches them is the natural place to sweep, so requests, checks, attempts and outcomes do
  // not accumulate for the life of the home.
  pruneVerificationRequests(db, now)
  const pending = db.raw
    .query<{ id: string }, [number]>(
      `SELECT id FROM verification_requests
       WHERE state = 'pending' AND expires_at > ?
       ORDER BY created_at LIMIT 20`,
    )
    .all(now)
  void paths
  await Promise.allSettled(pending.map((row) => dispatchVerificationRequest(row.id)))
}

/**
 * Live merged secrets, read at command start, so a credential learned mid-run is redacted from
 * retained output (BAZ-041 gap 3) rather than captured once at dispatch time.
 */
function currentSecrets(): readonly string[] {
  const { db, authToken } = getCtx()
  return codingSecrets(mergeSecretsIntoEnv(db, authToken))
}
