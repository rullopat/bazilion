import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type {
  ReviewRequestHost,
  ReviewRequestIntent,
  ReviewRequestReceipt,
} from '../../runtime/tools/review.ts'
import { captureTeamSnapshot } from '../git-review/service.ts'
import { resolveTeamMember } from '../team-member.ts'
import { captureReviewPacket } from './capture.ts'

// BAZ-043: the requester's half of a review.
//
// The story's task experience is "ask Alex to review this": the coder captures the current change, names an
// existing same-Team reviewer, sends one request and yields. Without this the only requester could be the
// operator — which is exactly the gap BAZ-044 had on the verification side, where the result delivery
// existed and was tested but was unreachable on any path an agent could actually take.
//
// Identity is bound here, in the daemon, from the turn that owns the host: the worker supplies the reviewer
// and a summary, and nothing else.

export interface ReviewRequestCapabilityInput {
  db: BazilionDb
  paths: Paths
  agentId: string
  teamId: string
  turnId: string
  /** Re-checked before the revision is captured, so a finished turn cannot capture anything. */
  assertActive: () => void
}

export function createReviewRequestHost(input: ReviewRequestCapabilityInput): ReviewRequestHost {
  return {
    async capture(intent: ReviewRequestIntent): Promise<ReviewRequestReceipt> {
      input.assertActive()
      const reviewer = resolveTeamMember(input.db, {
        teamId: input.teamId,
        requested: intent.reviewer,
        excludeAgentId: input.agentId,
      })
      if ('error' in reviewer) throw new Error(reviewer.error)

      // Captured now, for this turn: the packet must describe the change the coder is looking at, not a
      // capture it happened to know an id for.
      const captured = await captureTeamSnapshot(input.db, input.paths, input.teamId, {
        capturedBy: 'agent',
        agentId: input.agentId,
        turnId: input.turnId,
        toolCallId: `request_review:${input.turnId}`,
      })
      input.assertActive()
      if (!captured.snapshot.complete) {
        // An incomplete capture cannot support a claim about the revision, and reviewing part of a change
        // while presenting it as the change is worse than refusing.
        const reasons = captured.snapshot.issues.map((issue) => issue.code).join(', ')
        throw new Error(
          `the change could not be captured exactly${reasons ? ` (${reasons})` : ''}; nothing was requested`,
        )
      }
      const result = captureReviewPacket(input.db, input.paths, {
        teamId: input.teamId,
        snapshotId: captured.reference.id,
        reviewerAgentId: reviewer.agentId,
        summary: intent.summary ?? null,
        requesterKind: 'agent',
        requesterAgentId: input.agentId,
      })
      // A refusal is a result with a reason: nothing was written, and the model must not be told otherwise.
      if (result.kind === 'blocked') {
        throw new Error(
          `the review was not requested: ${result.blocker.reason} — ${result.blocker.detail}`,
        )
      }
      return {
        packetId: result.packet.id,
        snapshotId: result.packet.snapshotId,
        reviewer: result.packet.reviewerAgentId ?? reviewer.agentId,
        state: result.packet.state,
      }
    },
  }
}
