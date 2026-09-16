import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  getReviewPacket,
  listReviewConclusions,
  listReviewFindings,
} from '../../core/repos/review-packets.ts'
import { sendAgentMessage } from '../communication.ts'
import { readSnapshotApplicability } from '../git-review/service.ts'

// BAZ-043: hand the review back to whoever asked for it.
//
// Same shape and same reason as BAZ-044's verification result: a coder that asks for a review and yields
// would otherwise never learn the outcome, so the loop would be open at the last hop. Delivery goes through
// the canonical messenger, which means Team Policy applies to it like any other peer message, and a refused
// or held delivery never changes the review's own state — the findings stay readable by their owner and by
// the operator.

/** Bounded, so a long finding list cannot become an oversized peer message. */
const MAX_RESULT_CHARACTERS = 4_000

export interface ReviewResultInput {
  db: BazilionDb
  paths: Paths
  packetId: string
}

/**
 * Send the review outcome to the requester, when the requester was an Agent.
 *
 * Returns whether a message was handed to the messenger, for tests and diagnostics. Never throws.
 */
export async function deliverReviewResult(
  db: BazilionDb,
  paths: Paths,
  packetId: string,
): Promise<boolean> {
  const packet = getReviewPacket(db, packetId)
  if (!packet) return false
  if (packet.requesterKind !== 'agent' || !packet.requesterAgentId) return false
  const reviewerAgentId = packet.reviewerAgentId
  if (!reviewerAgentId) return false

  let applicability: 'identical' | 'changed' | 'unknown' = 'unknown'
  try {
    applicability = (await readSnapshotApplicability(db, paths, packet.teamId, packet.snapshotId))
      .comparison
  } catch {
    // Establishing applicability is evidence, never a reason to withhold the outcome.
  }

  const payload = renderResult(db, packet.id, applicability)
  try {
    sendAgentMessage(db, {
      from: reviewerAgentId,
      to: packet.requesterAgentId,
      payload,
      origin: 'review_result',
      attemptKind: 'review_result',
      // Per attempt identity: a rerun's result is its own delivery, and reusing the packet id would
      // collide with the first attempt's approval identity if the edge requires approval.
      attemptId: `${packet.id}:${listReviewConclusions(db, packet.id).length}`,
    })
    return true
  } catch (error) {
    // A denied or held result message is not a review failure, and the payload is never logged.
    console.warn(
      JSON.stringify({
        event: 'review_result_not_delivered',
        packetId: packet.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return false
  }
}

function renderResult(
  db: BazilionDb,
  packetId: string,
  applicability: 'identical' | 'changed' | 'unknown',
): string {
  const packet = getReviewPacket(db, packetId)
  const conclusions = listReviewConclusions(db, packetId)
  const findings = listReviewFindings(db, packetId)
  const unresolved = findings.filter((finding) => finding.state !== 'resolved')
  const lines = [
    `Review ${packetId}: ${conclusions.at(-1)?.conclusion ?? 'no conclusion recorded'}.`,
    `Change: revision ${packet?.snapshotId ?? 'unknown'} (base ${packet?.baseOid.slice(0, 12) ?? 'unknown'}).`,
    `Applicability: ${
      applicability === 'identical'
        ? 'unchanged since capture'
        : applicability === 'changed'
          ? 'changed since capture — the findings are about the captured revision, not the current code'
          : 'not checked'
    }`,
    '',
  ]
  if (findings.length === 0) {
    lines.push('Findings: none recorded.')
  } else {
    lines.push('Findings:')
    for (const finding of findings) {
      const lines_ =
        finding.lineStart === null
          ? ''
          : `:${finding.lineStart}${
              finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : ''
            }`
      lines.push(
        `  [${finding.severity}] ${finding.path}${lines_} — ${finding.note}${
          finding.state === 'resolved'
            ? ' (resolved)'
            : finding.state === 'unverified'
              ? ' (UNVERIFIED — the reviewer could not read this revision)'
              : ''
        }`,
      )
    }
  }
  if (unresolved.length > 0) {
    lines.push('', `${unresolved.length} finding(s) remain unresolved.`)
  }
  lines.push(
    '',
    'A review conclusion is a reviewer’s statement about this revision: it is not operator acceptance,',
    'not a passing test, and not permission to publish, merge or deploy. Nothing was executed by the',
    'review, so anything that needs running to be sure still needs running.',
  )
  const payload = lines.join('\n')
  return payload.length > MAX_RESULT_CHARACTERS
    ? `${payload.slice(0, MAX_RESULT_CHARACTERS)}\n[result truncated]`
    : payload
}
