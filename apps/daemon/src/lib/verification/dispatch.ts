import {
  getVerificationRequest,
  getVerificationRequestById,
} from '../../core/repos/verification-requests.ts'
import { mergeSecretsIntoEnv } from '../../core/secrets.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from '../agent-cancel.ts'
import { acquireAgentLifecycleLease } from '../agent-lifecycle-lease.ts'
import { codingSecrets } from '../coding-environment/diagnostics.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { getCtx } from '../ctx.ts'
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
import {
  abandonVerificationAttempt,
  createVerificationHost,
  settleVerificationAttempt,
} from './runner.ts'

// BAZ-044: the one dispatch owner for a verification request.
//
// Ordering mirrors the restricted review dispatcher: refuse early while the Agent is busy, hold the
// agent lifecycle lease across admission, then release the coder's workspace claim before the
// specialist takes the workspace. Nothing here streams to a client: frames are drained, and the
// request's outcome is settled from the executor-owned check outcomes rather than from anything the
// model said.

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
      abandonVerificationAttempt(db, {
        attemptId: admitted.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
        state: 'cancelled',
        error: 'verification was cancelled before it reported',
      })
      return 'settled'
    }
    if (failure) {
      // The turn itself failed. Checks it did not run stay unrun, and the attempt says why — an
      // attempt that reports no outcome is never presented as a result about the change.
      abandonVerificationAttempt(db, {
        attemptId: admitted.claim.attempt.id,
        requestId,
        leaseOwner: VERIFICATION_DISPATCH_OWNER,
        state: 'failed',
        error: failure,
      })
      return 'settled'
    }
    settleVerificationAttempt(db, {
      attemptId: admitted.claim.attempt.id,
      requestId,
      leaseOwner: VERIFICATION_DISPATCH_OWNER,
    })
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
    if (registered) unregisterAgent(request.recipientAgentId)
  }
}

/** Dispatch every eligible pending request. */
export async function dispatchPendingVerifications(now = Date.now()): Promise<void> {
  const { db, paths } = getCtx()
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
