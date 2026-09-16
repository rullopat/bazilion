import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getReviewPacket, setReviewPacketState } from '../../core/repos/review-packets.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
import { requireTeam } from '../git-review/service.ts'

// BAZ-043: releasing a held review request.
//
// A review the policy edge holds waits in `awaiting_approval` with no attempt claimed, so nothing is read
// and nothing is written. Approval revalidates the same inputs the operator saw before releasing it —
// membership, the reviewer, the reviewed revision inside its window — because those may have changed while
// it waited, and a released grant must not dispatch a review of evidence that is gone.

function safeTeam(db: BazilionDb, paths: Paths, teamId: string) {
  try {
    return requireTeam(db, paths, teamId)
  } catch {
    return null
  }
}

/** Why this held review cannot be released, or null when it can. */
export function validateReviewGrant(db: BazilionDb, paths: Paths, packetId: string): string | null {
  const packet = getReviewPacket(db, packetId)
  if (!packet) return 'review packet is unknown or past its retention window'
  if (packet.state !== 'awaiting_approval') {
    return `review packet is ${packet.state}, not awaiting approval`
  }
  const team = safeTeam(db, paths, packet.teamId)
  if (!team) return 'review packet no longer names a known Team'
  const reviewerId = packet.reviewerAgentId
  if (!reviewerId) return 'review packet has no reviewer to dispatch'
  const reviewer = getAgent(db, reviewerId)
  if (!reviewer || reviewer.status === 'archived')
    return 'the selected reviewer is missing or archived'
  if (reviewer.teamId !== team.id) return 'the selected reviewer left this Team'
  if (!getSourceSnapshot(db, team.id, packet.snapshotId)) {
    return 'the reviewed revision is no longer inside its retention window'
  }
  return null
}

/** Commit the release inside the approval decision, so a granted approval always has its effect. */
export function releaseReviewGrant(db: BazilionDb, packetId: string): void {
  const packet = getReviewPacket(db, packetId)
  // Only a still-held packet is released: a cancellation that raced the approval wins.
  if (packet?.state === 'awaiting_approval') setReviewPacketState(db, packetId, 'open')
}
