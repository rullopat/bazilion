import type { ReviewChangeStatus, SourceSnapshot } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { getSourceSnapshot, type SourceSnapshotRecord } from '../../core/repos/source-snapshots.ts'
import type { CapturedGit } from '../git/capture.ts'
import { attachPatches, listChanges, type ReviewChange } from './changes.ts'
import { readRepositoryIdentity, resolveComparisonBase } from './identity.ts'
import { requireTeam, withRepository } from './service.ts'
import { captureSourceSnapshot } from './snapshot.ts'

// File-level review feedback for Git change review (BAZ-042 slice 6).
//
// Identity is `(team, snapshotId, path)` — a file-level reference, because a snapshot already records
// a digest per changed path, so staleness stays decidable without synthesizing hunk identities. A
// selected line range travels as **context**, not as identity.
//
// The composed message is what actually crosses the normal chat ingress, so the snapshot reference is
// carried in the text itself: whatever queue or approval holds the message, the identity travels with
// it and no second queue or parallel record is created.

export const FEEDBACK_LIMITS = {
  excerptChars: 4000,
  noteChars: 2000,
} as const

export interface ReviewFeedbackRequest {
  path: string
  base?: string
  /** The reviewed snapshot. Absent means the feedback is not tied to one, and applicability is unknown. */
  snapshotId?: string
  startLine?: number
  endLine?: number
  note?: string
}

/**
 * Per-path staleness. Narrower than whole-tree applicability: it answers "are these the lines the
 * operator saw?", which is the property feedback must not violate.
 */
export type FeedbackApplicability = 'current' | 'stale' | 'unknown'

export interface ReviewFeedbackDocument {
  teamId: string
  path: string
  previousPath: string | null
  status: ReviewChangeStatus
  snapshotId: string | null
  lineRange: { start: number; end: number } | null
  excerpt: string | null
  /** Provenance of the excerpt, so it is never presented as the snapshot's own content. */
  excerptSource: 'current_read' | 'binary' | 'excluded' | 'omitted' | 'unavailable'
  applicability: FeedbackApplicability
  applicabilityReason: string
}

export const feedbackReferencePrefix = 'review-feedback:'

/** A compact, inert reference an operator or a peer can quote back. */
export function feedbackReference(document: ReviewFeedbackDocument): string {
  return `${feedbackReferencePrefix}${document.snapshotId ?? 'none'}:${document.path}`
}

/**
 * Compose the message that carries the feedback.
 *
 * Plain text by construction: the excerpt is code, so it is fenced and labelled with where it came
 * from, and the snapshot reference is stated explicitly rather than implied.
 */
export function composeFeedbackMessage(document: ReviewFeedbackDocument, note?: string): string {
  const lines = [
    `${feedbackReferencePrefix}${document.snapshotId ?? 'none'}`,
    `Repository source snapshot: ${document.snapshotId ?? '(not captured)'}`,
    `File: ${document.previousPath ? `${document.previousPath} -> ${document.path}` : document.path}`,
    `Change: ${document.status}`,
  ]
  if (document.lineRange)
    lines.push(`Selected lines: ${document.lineRange.start}-${document.lineRange.end} (context)`)
  lines.push(
    `Source identity: ${
      document.applicability === 'current'
        ? 'unchanged since this snapshot'
        : document.applicability === 'stale'
          ? 'CHANGED since this snapshot — the selected lines may have moved'
          : `unknown (${document.applicabilityReason})`
    }`,
  )
  if (document.excerpt !== null) {
    lines.push(
      '',
      `Excerpt (${document.excerptSource === 'current_read' ? 'read now, not stored in the snapshot' : document.excerptSource}):`,
      '```',
      document.excerpt,
      '```',
    )
  } else {
    lines.push('', `Excerpt: unavailable (${document.excerptSource})`)
  }
  const trimmed = note?.trim()
  if (trimmed) lines.push('', `Operator note: ${trimmed.slice(0, FEEDBACK_LIMITS.noteChars)}`)
  return lines.join('\n')
}

/**
 * Build review feedback for one path.
 *
 * The excerpt is read now rather than taken from the client: the operator's selection identifies
 * *which* lines, not what they contain, and a snapshot stores digests rather than content. Its
 * provenance is labelled so it is never passed off as the snapshot's own bytes.
 */
export async function buildReviewFeedback(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  request: ReviewFeedbackRequest,
): Promise<ReviewFeedbackDocument> {
  const team = requireTeam(db, paths, teamId)
  const record = request.snapshotId ? getSourceSnapshot(db, team.id, request.snapshotId) : null
  const stored = parseStoredSnapshot(record)
  return withRepository(team.path, async (captured) => {
    const base = await resolveComparisonBase(captured, request.base ?? 'HEAD')
    const identity = await readRepositoryIdentity(captured)
    const listed = await attachPatches(
      captured,
      await listChanges(captured, base, identity),
      undefined,
      request.path,
    )
    const change = listed.changes.find((entry) => entry.path === request.path)
    if (!change)
      throw new FeedbackTargetError('unknown_path', 'That path is not changed since this baseline.')
    const current = await captureSourceSnapshot(captured, base, identity)
    return {
      teamId: team.id,
      path: change.path,
      previousPath: change.previousPath,
      status: change.status,
      snapshotId: request.snapshotId ?? null,
      lineRange: lineRange(request, captured),
      excerpt: excerptOf(change),
      excerptSource: excerptSource(change),
      ...applicabilityOf(stored, current, change.path),
    }
  })
}

export class FeedbackTargetError extends Error {
  readonly code: 'unknown_path' | 'invalid_range'
  constructor(code: 'unknown_path' | 'invalid_range', message: string) {
    super(message)
    this.name = 'FeedbackTargetError'
    this.code = code
  }
}

/**
 * Compare one path against the reviewed snapshot.
 *
 * Both sides are compared by recorded digest, and both must be complete: an incomplete capture on
 * either side yields `unknown` rather than a hopeful `current`.
 */
function applicabilityOf(
  stored: SourceSnapshot | null,
  current: SourceSnapshot,
  path: string,
): { applicability: FeedbackApplicability; applicabilityReason: string } {
  if (!stored) return { applicability: 'unknown', applicabilityReason: 'no_snapshot' }
  if (!stored.complete)
    return { applicability: 'unknown', applicabilityReason: 'incomplete_snapshot' }
  if (!current.complete)
    return { applicability: 'unknown', applicabilityReason: 'capture_incomplete' }
  const before = stored.entries.find((entry) => entry.path === path) ?? null
  const after = current.entries.find((entry) => entry.path === path) ?? null
  if (before === null && after === null) {
    // Unchanged relative to the pinned base on both sides: the same lines.
    return { applicability: 'current', applicabilityReason: 'path_unchanged' }
  }
  if (before?.digest && before.digest === after?.digest && before.kind === after?.kind) {
    return { applicability: 'current', applicabilityReason: 'path_unchanged' }
  }
  return { applicability: 'stale', applicabilityReason: 'path_changed' }
}

function parseStoredSnapshot(record: SourceSnapshotRecord | null): SourceSnapshot | null {
  if (!record) return null
  try {
    return JSON.parse(record.manifestJson) as SourceSnapshot
  } catch {
    return null
  }
}

function excerptSource(change: ReviewChange): ReviewSnapshotExcerptSource {
  if (change.excludedReason) return 'excluded'
  if (change.binary) return 'binary'
  if (change.patch === null) return 'omitted'
  return 'current_read'
}

type ReviewSnapshotExcerptSource = ReviewFeedbackDocument['excerptSource']

function excerptOf(change: ReviewChange): string | null {
  if (change.excludedReason || change.binary || change.patch === null) return null
  return change.patch.slice(0, FEEDBACK_LIMITS.excerptChars)
}

/** Validate an optional selected line range. A range is context only — it never identifies the review. */
function lineRange(
  request: ReviewFeedbackRequest,
  _captured: CapturedGit,
): { start: number; end: number } | null {
  const { startLine, endLine } = request
  if (startLine === undefined && endLine === undefined) return null
  const start = startLine ?? endLine
  const end = endLine ?? startLine
  if (
    start === undefined ||
    end === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end > 1_000_000
  ) {
    throw new FeedbackTargetError(
      'invalid_range',
      'Selected lines must be an ordered positive range.',
    )
  }
  return { start, end }
}
