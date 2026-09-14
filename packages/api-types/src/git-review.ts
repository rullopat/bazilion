// Git change review wire shapes (BAZ-042). Hermetic: plain types plus one constant, no daemon code,
// no node-only imports. The daemon, `@bazilion/client`, the CLI and the web panel all speak these.

/** Machine-readable issue codes. Messages are for operators and never embed host paths. */
export type ReviewIssueCode =
  | 'unborn_head'
  | 'invalid_base'
  | 'unknown_base'
  | 'git_output_limit'
  | 'file_limit'
  | 'patch_unavailable'
  | 'unstable'

export interface ReviewIssue {
  code: ReviewIssueCode
  message: string
}

/** Why a path may not be captured. */
export type ReviewScopeReason = 'bazilion_state' | 'credential_shaped'

export interface RepositoryIdentity {
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null
  /** Commit HEAD points at, or null when the branch is unborn. */
  head: string | null
  headState: 'branch' | 'detached' | 'unborn'
}

/**
 * A comparison point pinned to a concrete commit. `resolvedOid` is the only value a comparison may
 * use; `requestedRef` records what was asked for, so a moved branch tip cannot rewrite a review.
 */
export interface PinnedBase {
  requestedRef: string
  resolvedOid: string
}

/** Bounds applied to a review or a snapshot. */
export interface ReviewLimits {
  files: number
  fileBytes: number
  totalBytes: number
  /** Rendered patch cap per file; a longer diff is cut and marked truncated. */
  patchBytes: number
}

/** Refinement limits: 1,000 files, 1 MiB per text file, 16 MiB total captured content. */
export const REVIEW_LIMITS: ReviewLimits = {
  files: 1000,
  fileBytes: 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  patchBytes: 256 * 1024,
}

export type ReviewChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type_changed'
  | 'unmerged'
  | 'untracked'
  | 'unknown'

/** Why an entry carries no content. Never a silent omission. */
export type ContentOmission =
  | 'untracked_not_selected'
  | 'excluded'
  | 'binary'
  | 'too_large'
  | 'total_limit'
  | 'file_limit'
  | 'unavailable'

export interface ReviewChange {
  /** Repository-relative path, destination side for renames. */
  path: string
  /** Source path for a rename or copy, otherwise null. */
  previousPath: string | null
  status: ReviewChangeStatus
  binary: boolean
  addedLines: number | null
  deletedLines: number | null
  oldMode: string | null
  newMode: string | null
  /** Unified diff text, or null when content was omitted. */
  patch: string | null
  patchTruncated: boolean
  contentOmitted: ContentOmission | null
  /** Set when the path was refused by scope policy. */
  excludedReason: ReviewScopeReason | null
}

/** "Changes since baseline": the pinned base compared against the working tree. */
export interface RepositoryChanges {
  base: PinnedBase
  identity: RepositoryIdentity
  changes: ReviewChange[]
  /** True when the change list itself was cut by the file limit. */
  truncated: boolean
  /** Counts of what was *not* captured, so an omission is never invisible. */
  withheld: { untracked: number; excluded: number; binary: number; tooLarge: number }
  issues: ReviewIssue[]
}

export type SnapshotEntryLayer = 'worktree' | 'untracked'

export type SnapshotEntryKind = 'file' | 'deleted' | 'not_regular' | 'too_large' | 'unstable'

export interface SnapshotEntry {
  path: string
  layer: SnapshotEntryLayer
  kind: SnapshotEntryKind
  /** sha256 of the captured bytes, or null when no content could be read. */
  digest: string | null
  bytes: number | null
}

/**
 * Bounded code evidence: HEAD, the index, the dirty tracked bytes and any explicitly included
 * untracked content. Paths and digests only — never file content.
 */
export interface SourceSnapshot {
  /** Content-addressed over the captured state; identical trees share an id. */
  id: string
  capturedAt: number
  /** False whenever any entry could not be fingerprinted; applicability is then unknown. */
  complete: boolean
  identity: RepositoryIdentity
  base: PinnedBase
  head: string | null
  indexDigest: string | null
  indexEntries: number
  entries: SnapshotEntry[]
  untrackedIncluded: string[]
  exclusions: { path: string; reason: ReviewScopeReason }[]
  withheld: { excluded: number; tooLarge: number; notRegular: number; unstable: number }
  limits: ReviewLimits
  issues: ReviewIssue[]
}

/** The small immutable handoff a receipt or a verification request carries. */
export interface SnapshotReference {
  id: string
  complete: boolean
  capturedAt: number
}

/**
 * Applicability of one snapshot against another. `unknown` whenever either side is incomplete — an
 * incomplete snapshot is never reported as unchanged.
 */
export type SnapshotComparison = 'identical' | 'changed' | 'unknown'

/** Operator-visible snapshot record, without the manifest body. */
export interface SourceSnapshotSummary {
  snapshotId: string
  teamId: string
  agentId: string
  turnId: string
  toolCallId: string
  complete: boolean
  head: string | null
  baseOid: string
  entryCount: number
  capturedContentBytes: number
  createdAt: number
  expiresAt: number
}

export interface RepositoryReviewResponse {
  teamId: string
  changes: RepositoryChanges
}

export interface SourceSnapshotListResponse {
  snapshots: SourceSnapshotSummary[]
}

export interface CaptureSourceSnapshotRequest {
  /** Untracked paths to include by content. Names only; nothing is included implicitly. */
  includeUntracked?: string[]
  base?: string
}

export interface SourceSnapshotResponse {
  snapshot: SourceSnapshot
  reference: SnapshotReference
}
