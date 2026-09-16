import type {
  RepositoryChanges,
  RepositoryIdentity,
  ReviewChange,
  SourceSnapshotSummary,
  SnapshotReference,
} from '@bazilion/api-types'

// Presentation-only helpers for the Git review panel (BAZ-042). Pure functions so they can be
// tested without a browser, and so the panel never invents wording inline.

/** Readable label for a change status. */
export function changeStatusLabel(status: ReviewChange['status']): string {
  switch (status) {
    case 'added':
      return 'added'
    case 'modified':
      return 'modified'
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'type_changed':
      return 'type changed'
    case 'unmerged':
      return 'unmerged'
    case 'untracked':
      return 'untracked'
    default:
      return 'changed'
  }
}

/**
 * One-line summary of a change.
 *
 * A withheld path says what was withheld instead of showing a bare or misleading zero, and a binary
 * file is never described with line counts it does not have.
 */
export function changeSummary(change: ReviewChange): string {
  const label = changeStatusLabel(change.status)
  if (change.excludedReason === 'credential_shaped') return `${label} · content withheld (credential-shaped)`
  if (change.excludedReason === 'bazilion_state') return `${label} · content withheld (Bazilion state)`
  if (change.contentOmitted === 'untracked_not_selected') return `${label} · content not selected`
  if (change.binary) return `${label} · binary`
  if (change.addedLines === null || change.deletedLines === null) return label
  return `${label} · +${change.addedLines} −${change.deletedLines}`
}

/** Where the review's baseline came from, and what it resolved to. */
export function baseLabel(identity: RepositoryIdentity, changes: RepositoryChanges): string {
  const head =
    identity.headState === 'detached'
      ? `detached at ${short(identity.head)}`
      : identity.headState === 'unborn'
        ? `unborn on ${identity.branch ?? '(unknown branch)'}`
        : (identity.branch ?? '(unknown branch)')
  return `${head} · base ${changes.base.requestedRef} (${short(changes.base.resolvedOid)})`
}

export function short(oid: string | null): string {
  return oid === null ? '—' : oid.slice(0, 12)
}

/**
 * Truthful copy for an unavailable review.
 *
 * A Team that is not a repository, or whose layout is unsupported, must read as *not reviewable* —
 * never as an empty change list, which would look like "nothing changed".
 */
export function unavailableMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'not_repository':
      return 'This Team workspace is not a Git repository, so there are no changes to review.'
    case 'unsupported_layout':
      return `${fallback} Bazilion does not widen mounts or run repository helpers to make inspection work; use a repository whose work tree and metadata are reachable from the Team root.`
    case 'invalid_base':
      return 'That comparison base is not a plain branch, tag or commit id.'
    case 'unknown_base':
      return 'That comparison base does not name a commit in this repository.'
    default:
      return fallback
  }
}

/** Snapshot list label, distinguishing an incomplete capture from an exact one. */
export function snapshotLabel(snapshot: SourceSnapshotSummary): string {
  const when = new Date(snapshot.createdAt).toISOString().replace('T', ' ').slice(0, 16)
  const state = snapshot.complete ? 'complete' : 'incomplete (applicability unknown)'
  return `${snapshot.snapshotId.slice(0, 12)} · ${state} · ${snapshot.capturedBy} · ${when} · ${snapshot.entryCount} entries`
}

/**
 * Wording for a receipt's source applicability.
 *
 * Absence is **Not checked**: a receipt with no captured source can never read as passing, and
 * `changed` says only that the code moved, never that the result is wrong.
 */
export function applicabilityLabel(
  state: { comparison: 'identical' | 'changed' | 'unknown'; reason: string } | null,
): string {
  if (state === null) return 'Source: Not checked'
  switch (state.comparison) {
    case 'identical':
      return 'Source: unchanged since this result was produced'
    case 'changed':
      return 'Source: changed since this result was produced — relevance unknown'
    default:
      return `Source: unknown (${state.reason.replaceAll('_', ' ')})`
  }
}

/** Whether an applicability verdict warrants a warning presentation. */
export function applicabilityWarns(state: { comparison: 'identical' | 'changed' | 'unknown' } | null): boolean {
  return state !== null && state.comparison !== 'identical'
}

export function referenceLabel(reference: SnapshotReference): string {
  return `${reference.id.slice(0, 12)} · ${reference.complete ? 'complete' : 'incomplete'}`
}
