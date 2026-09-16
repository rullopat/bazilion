import type { ReviewExport } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  getTeamReviewPacket,
  listReviewConclusions,
  listReviewFindings,
  recordReviewExport,
} from '../../core/repos/review-packets.ts'
import { listVerificationRequests } from '../../core/repos/verification-requests.ts'
import { readSnapshotApplicability, readTeamReview } from '../git-review/service.ts'
import { readVerificationSummary } from '../verification/capture.ts'

// BAZ-043: the handoff.
//
// A handoff is where overclaiming does the most damage, so this module's job is to say what is *known*
// and to name what is not. Three rules:
//
//   1. **One revision.** The export names the captured revision it describes, and records that revision
//      on the packet. A later revision cannot inherit the export.
//   2. **A patch only when the patch would be true.** BAZ-042 snapshots store paths and digests, never
//      content. A patch for the reviewed revision can therefore be produced only while the working tree
//      still matches the capture. Once it does not, the export says so and offers no patch rather than
//      presenting a diff of different code as the reviewed change.
//   3. **Evidence is cited, never asserted.** Checks are named with their receipt ids; a review
//      conclusion is labelled as a reviewer's statement; every reported external state stays reported.

export type ReviewExportRefusal =
  | { reason: 'packet_unavailable'; detail: string }
  | { reason: 'snapshot_unavailable'; detail: string }

export type ReviewExportResult =
  | { kind: 'exported'; export: ReviewExport }
  | { kind: 'refused'; refusal: ReviewExportRefusal }

/** Bounded: a handoff is a summary, not a copy of the change. */
const MAX_PATCH_BYTES = 200_000

export async function buildReviewExport(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  packetId: string,
): Promise<ReviewExportResult> {
  const packet = getTeamReviewPacket(db, teamId, packetId)
  if (!packet) {
    return {
      kind: 'refused',
      refusal: { reason: 'packet_unavailable', detail: 'unknown review packet' },
    }
  }
  const findings = listReviewFindings(db, packet.id)
  const conclusions = listReviewConclusions(db, packet.id)

  const limitations: string[] = []
  // The patch, and the honest condition under which one exists at all.
  let patch = ''
  let patchTruncated = false
  let revisionMatches = false
  try {
    const review = await readTeamReview(db, paths, teamId, { base: packet.baseOid, patches: true })
    // Whole-revision identity comes from the snapshot comparison, not from the diff: the diff says what
    // changed since the base, never whether it is still the code that was reviewed.
    const applicability = await readSnapshotApplicability(db, paths, teamId, packet.snapshotId)
    revisionMatches = applicability.comparison === 'identical'
    if (!revisionMatches) {
      limitations.push(
        'The working tree has changed since this revision was captured, so no patch is offered: a diff ' +
          'of the current code would not be the reviewed change. Re-capture and re-review to hand off ' +
          'the current state.',
      )
    } else {
      const pieces: string[] = []
      for (const change of review.changes.changes) {
        if (!change.patch) continue
        pieces.push(`--- ${change.path}\n${change.patch}`)
      }
      patch = pieces.join('\n')
      if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) {
        patch = patch.slice(0, MAX_PATCH_BYTES)
        patchTruncated = true
        limitations.push('The patch was truncated at the export limit.')
      }
      if (review.changes.truncated) {
        patchTruncated = true
        limitations.push('The change list was truncated by the review limits.')
      }
    }
  } catch {
    limitations.push(
      'The repository could not be read at export time, so this handoff carries no patch. The reviewed ' +
        'revision and its findings are unaffected.',
    )
  }

  // Verification evidence, when the packet was reviewed alongside one. Cited by receipt id, never
  // summarised into a verdict.
  const checkLines: string[] = []
  // Verification requested against the *same* captured revision: evidence about this change, not about a
  // different one that happens to be in the Team.
  for (const request of listVerificationRequests(db, teamId)) {
    if (request.snapshotId !== packet.snapshotId) continue
    const summary = readVerificationSummary(db, paths, teamId, request.id)
    if (!summary) continue
    for (const attempt of summary.attempts) {
      for (const outcome of attempt.outcomes) {
        checkLines.push(
          `- ${outcome.state}${outcome.exitCode === null ? '' : ` (exit ${outcome.exitCode})`}${
            outcome.commandId
              ? ` — coding-receipt:${outcome.commandId}`
              : outcome.receiptUnavailable
                ? ' — receipt no longer available'
                : ''
          }`,
        )
      }
    }
  }

  const unresolved = findings
    .filter((finding) => finding.state !== 'resolved')
    .map((finding) => ({
      path: finding.path,
      severity: finding.severity,
      note: finding.note,
      // Whole-revision applicability: the same capture either still matches or it does not.
      applicability: (revisionMatches ? 'identical' : 'changed') as
        | 'identical'
        | 'changed'
        | 'unknown',
    }))
  if (findings.some((finding) => finding.state === 'unverified')) {
    limitations.push(
      'At least one finding is unverified: it could not be correlated to the reviewed revision, so it is ' +
        'reported as unverified rather than attached to a line.',
    )
  }
  if (unresolved.length > 0) {
    limitations.push(
      `${unresolved.length} finding(s) remain unresolved. A handoff with open findings is not a statement ` +
        'that the change is ready.',
    )
  }
  if (!packet.snapshotComplete) {
    limitations.push('The reviewed revision was captured with incomplete coverage.')
  }
  limitations.push(
    'A review conclusion is a reviewer’s statement about this revision. It is not operator acceptance, ' +
      'not a merge, and not a deployment, and nothing in this export performs one.',
  )

  const handoff = renderHandoff({
    packetId: packet.id,
    revision: packet.snapshotId,
    baseOid: packet.baseOid,
    summary: packet.summary,
    conclusions,
    unresolved,
    checkLines,
    limitations,
  })

  recordReviewExport(db, packet.id, packet.snapshotId)
  return {
    kind: 'exported',
    export: {
      packetId: packet.id,
      revision: packet.snapshotId,
      snapshotId: packet.snapshotId,
      baseOid: packet.baseOid,
      patch,
      patchTruncated,
      handoff,
      unresolved,
      limitations,
    },
  }
}

function renderHandoff(input: {
  packetId: string
  revision: string
  baseOid: string
  summary: string | null
  conclusions: ReturnType<typeof listReviewConclusions>
  unresolved: ReviewExport['unresolved']
  checkLines: string[]
  limitations: string[]
}): string {
  const lines = [
    '# Handoff',
    '',
    `Reviewed revision: ${input.revision.slice(0, 16)} (base ${input.baseOid.slice(0, 12)})`,
    `Review packet: ${input.packetId}`,
    '',
    '## Problem',
    input.summary ?? '(the requester did not state one)',
    '',
    '## Resulting behaviour',
    input.conclusions.length === 0
      ? 'A review conclusion has not been recorded for this revision, so there is no reviewer statement to report.'
      : input.conclusions
          .map((conclusion) => {
            const who =
              conclusion.reviewerKind === 'agent' ? conclusion.reviewerAgentId : 'operator'
            return `- ${conclusion.conclusion} (${who})${conclusion.note ? `: ${conclusion.note}` : ''}`
          })
          .join('\n'),
    '',
    '## Verification',
    input.checkLines.length === 0
      ? 'No executor-owned check evidence is attached to this revision.'
      : input.checkLines.join('\n'),
    '',
    '## Unresolved findings',
    input.unresolved.length === 0
      ? 'None recorded against this revision.'
      : input.unresolved
          .map(
            (finding) =>
              `- [${finding.severity}] ${finding.path} — ${finding.note} (applicability: ${finding.applicability})`,
          )
          .join('\n'),
    '',
    '## Limitations',
    ...input.limitations.map((limitation) => `- ${limitation}`),
    '',
  ]
  return lines.join('\n')
}
