import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import {
  getVerificationRequestById,
  setRequestState,
} from '../../core/repos/verification-requests.ts'
import { requireTeam } from '../git-review/service.ts'

// BAZ-044: releasing a held verification request.
//
// A held request is a **durable grant**, exactly like a scheduler trigger: approving it records the
// decision and moves the request back into `pending`, where the verification state machine alone claims
// and executes it. Nothing runs inside the HTTP request.
//
// The grant revalidates before releasing, because the world may have moved while the request waited:
// if the specialist left the Team, or the captured evidence fell out of its window, the honest outcome
// is a refusal that leaves the request held rather than a release that will fail at admission.

/** Return an error string when the request can no longer be released, or null when it can. */
export function validateVerificationGrant(
  db: BazilionDb,
  paths: Paths,
  requestId: string,
): string | null {
  const request = getVerificationRequestByIdSafe(db, requestId)
  if (!request) return 'verification request is unknown or past its retention window'
  if (request.state !== 'awaiting_approval') {
    return `verification request is ${request.state}, not awaiting approval`
  }
  const team = safeTeam(db, paths, request.teamId)
  if (!team) return 'verification request no longer names a known Team'
  const recipient = getAgent(db, request.recipientAgentId)
  if (!recipient || recipient.status === 'archived') {
    return 'the selected specialist is missing or archived'
  }
  if (recipient.teamId !== team.id) return 'the selected specialist left this Team'
  if (!getSourceSnapshot(db, team.id, request.snapshotId)) {
    return 'the captured change is no longer inside its retention window'
  }
  return null
}

/** Commit the release inside the approval decision, so a granted approval always has its effect. */
export function releaseVerificationGrant(db: BazilionDb, requestId: string): void {
  const request = getVerificationRequestByIdSafe(db, requestId)
  // Only a still-held request is released: a cancellation that raced the approval wins.
  if (request?.state === 'awaiting_approval') setRequestState(db, requestId, 'pending')
}

/** By id alone: an approval references a request, and its Team is read from the row itself. */
function getVerificationRequestByIdSafe(db: BazilionDb, requestId: string) {
  return getVerificationRequestById(db, requestId)
}

function safeTeam(db: BazilionDb, paths: Paths, teamId: string) {
  try {
    return requireTeam(db, paths, teamId)
  } catch {
    return null
  }
}
