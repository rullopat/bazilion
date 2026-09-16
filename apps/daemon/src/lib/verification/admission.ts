import { randomUUID } from 'node:crypto'
import type { VerificationBlocker, VerificationBlockerReason } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import {
  claimVerificationAttempt,
  getVerificationRequestById,
  setRequestState,
  type VerificationClaim,
} from '../../core/repos/verification-requests.ts'
import { authorizeCommunication } from '../../core/team-policy/authorization.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { WorkspaceBusyError, type WorkspaceLease } from '../coding-environment/workspace.ts'
import {
  authorizeUserIngress,
  authorizeVerificationRequest,
  teamPolicyEnforcementEnabled,
} from '../communication.ts'
import { readSnapshotApplicability, requireTeam } from '../git-review/service.ts'

// BAZ-044: admission for one captured verification request.
//
// Admission is the whole pre-execution boundary, and it runs in a deliberate order:
//
//   1. revalidate the captured inputs *before* anything durable is claimed, so a request that can
//      no longer be honoured is refused without leaving an attempt behind;
//   2. claim the single dispatch slot, because an execution must be recoverable as `uncertain`
//      rather than replayable if the process dies mid-run;
//   3. reserve the workspace exclusively and prove the live tree still matches the captured change,
//      because a check run against a different tree proves nothing about the captured one.
//
// Anything that cannot be established is reported as a blocker. Nothing is substituted: not a
// different tree, not a relaxed policy, not a fresh snapshot.

/** Claim lease window. Long enough for a bounded check set, short enough to recover promptly. */
export const VERIFICATION_LEASE_MS = 10 * 60 * 1000

/** Process identity for claims: another process's claim is recovered as uncertain, never adopted. */
const DISPATCH_OWNER = randomUUID()

export type VerificationAdmission =
  | {
      kind: 'admitted'
      requestId: string
      claim: VerificationClaim
      workspace: WorkspaceLease
    }
  /** Refused with a reason that is recorded on the request. */
  | { kind: 'blocked'; requestId: string; blocker: VerificationBlocker }
  /** Policy now holds the request; the canonical approval machinery owns it. */
  | { kind: 'held'; requestId: string }
  /** Nothing to do right now; the request stays pending and is retried by the next tick. */
  | {
      kind: 'deferred'
      requestId: string
      reason: 'unknown_or_expired' | 'workspace_busy' | 'already_owned'
    }

/**
 * Admit one request for execution.
 *
 * On `admitted` the caller owns both the attempt claim and the workspace lease and **must** settle
 * the attempt and release the lease, including on failure.
 */
export async function admitVerificationRequest(
  db: BazilionDb,
  paths: Paths,
  requestId: string,
  now = Date.now(),
): Promise<VerificationAdmission> {
  const request = getVerificationRequestById(db, requestId, now)
  // An unknown or expired request is not an error to report: there is simply nothing to run.
  if (!request) return { kind: 'deferred', requestId, reason: 'unknown_or_expired' }

  const blockedReason = async (): Promise<VerificationBlocker | null> => {
    const team = safeTeam(db, paths, request.teamId)
    if (!team) return blocker('unsupported', 'the request no longer names a known Team')
    const recipient = getAgent(db, request.recipientAgentId)
    if (!recipient || recipient.status === 'archived') {
      return blocker('recipient_unavailable', 'the selected specialist is missing or archived')
    }
    if (recipient.teamId !== team.id) {
      return blocker('recipient_not_same_team', 'the selected specialist left this Team')
    }
    // The captured evidence must still be inside its window: without it, applicability cannot be
    // established and a result could not be tied to the change it claims to describe.
    if (!getSourceSnapshot(db, team.id, request.snapshotId, now)) {
      return blocker(
        'snapshot_evidence_gone',
        'the captured change is no longer inside its retention window',
      )
    }
    return null
  }

  const refusal = await blockedReason()
  if (refusal) {
    setRequestState(db, requestId, 'blocked')
    return { kind: 'blocked', requestId, blocker: refusal }
  }

  // Re-evaluate the canonical edge on every attempt. A request that was allowed when captured is
  // not allowed forever: membership and directed policy may have changed since.
  const decision = teamPolicyEnforcementEnabled()
    ? authorizeCommunication(db, authorizationFor(request, requestId))
    : ({ decision: 'allow' } as const)
  if (decision.decision === 'deny') {
    setRequestState(db, requestId, 'blocked')
    return {
      kind: 'blocked',
      requestId,
      blocker: blocker('policy_denied', 'the current Team policy no longer permits this request'),
    }
  }
  if (decision.decision === 'approval_required') {
    // Capture the attempt through the canonical approver, which creates the durable approval row
    // and throws its pending error. The request waits; release never executes anything.
    try {
      if (request.requesterKind === 'agent' && request.requesterAgentId) {
        authorizeVerificationRequest(db, {
          from: request.requesterAgentId,
          to: request.recipientAgentId,
          requestId,
        })
      } else {
        authorizeUserIngress(db, request.recipientAgentId, {
          origin: 'verification_request',
          attemptKind: 'verification_request',
          attemptId: requestId,
          approvalPayloadKind: 'verification_request',
          approvalPayload: { requestId },
          requester: 'user',
        })
      }
      // A policy that reports approval_required without holding the attempt is a contract breach.
      setRequestState(db, requestId, 'blocked')
      return {
        kind: 'blocked',
        requestId,
        blocker: blocker('approval_required', 'the request was not captured for approval'),
      }
    } catch {
      setRequestState(db, requestId, 'awaiting_approval')
      return { kind: 'held', requestId }
    }
  }

  // Reserve the workspace before claiming: a busy workspace is a deferral, not a failed request.
  let workspace: WorkspaceLease
  try {
    const team = requireTeam(db, paths, request.teamId)
    workspace = await workspaceLifecycle(db).claim(team.id, team.path, 'agent')
  } catch (error) {
    if (error instanceof WorkspaceBusyError) {
      return { kind: 'deferred', requestId, reason: 'workspace_busy' }
    }
    throw error
  }

  const claim = claimVerificationAttempt(db, {
    requestId,
    leaseOwner: DISPATCH_OWNER,
    leaseMs: VERIFICATION_LEASE_MS,
    now,
  })
  if (!claim) {
    await workspaceLifecycle(db).release(workspace)
    return { kind: 'deferred', requestId, reason: 'already_owned' }
  }

  // Prove the reserved tree is the captured one. A coder or an external editor may have moved it
  // while the request waited; running here would test a different change and call it verified.
  const applicability = await readSnapshotApplicability(
    db,
    paths,
    request.teamId,
    request.snapshotId,
  )
  if (applicability.comparison !== 'identical') {
    await workspaceLifecycle(db).release(workspace)
    const reason: VerificationBlockerReason =
      applicability.comparison === 'changed' ? 'source_changed' : 'source_unverifiable'
    const detail =
      applicability.comparison === 'changed'
        ? 'the workspace changed after the capture, so a fresh capture is required'
        : 'the workspace could not be shown to match the captured change'
    // The attempt is settled honestly: it was claimed, and it ran nothing.
    settleUnstarted(db, claim, detail)
    setRequestState(db, requestId, 'blocked')
    return { kind: 'blocked', requestId, blocker: blocker(reason, detail) }
  }

  return { kind: 'admitted', requestId, claim, workspace }
}

function authorizationFor(
  request: {
    requesterKind: string
    requesterAgentId: string | null
    recipientAgentId: string
    teamId: string
  },
  requestId: string,
) {
  const attempt = {
    origin: 'verification_request',
    attemptKind: 'verification_request',
    attemptId: requestId,
  }
  return request.requesterKind === 'agent' && request.requesterAgentId
    ? {
        source: { kind: 'agent' as const, id: request.requesterAgentId },
        target: { kind: 'agent' as const, id: request.recipientAgentId },
        ...attempt,
      }
    : {
        source: { kind: 'user' as const, teamId: request.teamId },
        target: { kind: 'agent' as const, id: request.recipientAgentId },
        ...attempt,
      }
}

/** Settle a claimed-but-unstarted attempt, so nothing is left holding the dispatch slot. */
function settleUnstarted(db: BazilionDb, claim: VerificationClaim, error: string): void {
  db.raw.run(
    `UPDATE verification_attempts
     SET state = 'failed', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL, error = ?
     WHERE id = ? AND lease_owner IS NOT NULL AND finished_at IS NULL`,
    [Date.now(), error, claim.attempt.id],
  )
  db.raw.run(
    `UPDATE verification_check_outcomes SET state = 'blocked', finished_at = ?
     WHERE attempt_id = ? AND state = 'not_executed'`,
    [Date.now(), claim.attempt.id],
  )
}

function blocker(reason: VerificationBlockerReason, detail: string): VerificationBlocker {
  return { reason, detail }
}

function safeTeam(db: BazilionDb, paths: Paths, teamId: string) {
  try {
    return requireTeam(db, paths, teamId)
  } catch {
    return null
  }
}
