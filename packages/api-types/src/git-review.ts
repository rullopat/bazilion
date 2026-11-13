// Git change review of a Team workspace: the changes since a pinned base, and file feedback.

import type { UserQueueItem } from './user-queue.ts'

/** Machine-readable issue codes. Messages are for operators and never embed host paths. */
export type ReviewIssueCode = 'invalid_base' | 'unknown_base' | 'git_output_limit' | 'file_limit'

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

/** Bounds applied to a review. */
export interface ReviewLimits {
  files: number
  fileBytes: number
  totalBytes: number
  /** Rendered patch cap per file; a longer diff is cut and marked truncated. */
  patchBytes: number
}

/** 1,000 files, 1 MiB per file diff, 16 MiB of diff text in total. */
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

/** Why an entry carries no diff text. Never a silent omission. */
export type ContentOmission = 'excluded' | 'binary' | 'too_large' | 'total_limit' | 'unavailable'

export interface ReviewChange {
  /** Repository-relative path, destination side for renames. */
  path: string
  /** Source path for a rename or copy, otherwise null. */
  previousPath: string | null
  status: ReviewChangeStatus
  binary: boolean
  addedLines: number | null
  deletedLines: number | null
  /** Unified diff text, or null when content was omitted or not requested. */
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
  /** Counts of what was *not* listed or captured, so an omission is never invisible. */
  withheld: { untracked: number; excluded: number }
  issues: ReviewIssue[]
}

export interface RepositoryReviewResponse {
  teamId: string
  changes: RepositoryChanges
}

/** Queue feedback about one changed file for a Team member. */
export interface ReviewFeedbackRequest {
  path: string
  agentId: string
  note?: string
  /** Comparison base the operator is reviewing (default HEAD). */
  base?: string
}

export interface ReviewFeedbackResponse {
  /** The exact message that was queued for the Agent. */
  message: string
  item: UserQueueItem
}
