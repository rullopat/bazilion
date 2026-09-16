import type { SnapshotComparison } from './git-review.ts'

/**
 * BAZ-043 wire shapes: a revision-bound review packet, its findings and its conclusion.
 *
 * Hermetic, like the rest of this package. Two boundaries are encoded in the types rather than left to
 * prose:
 *
 *   - A **finding** is about one path in one revision. The line range is context, never identity,
 *     because lines move while the issue stays the same.
 *   - A **conclusion** is a reviewer's statement about a revision. It is never a pass, never operator
 *     acceptance, and never a publication state.
 */

export type ReviewSeverity = 'blocker' | 'major' | 'minor' | 'info'
export type ReviewConclusion = 'changes_requested' | 'commented' | 'recommended'
export type ReviewPacketState =
  | 'open'
  | 'awaiting_approval'
  | 'blocked'
  | 'reviewing'
  | 'reviewed'
  | 'cancelled'
export type ReviewFindingState = 'open' | 'unverified' | 'resolved'
export type ReviewResolutionKind = 'explicit' | 'linked_revision'
export type ReviewAuthorKind = 'agent' | 'operator'

/** Who asked for the review, and who is reviewing it. Either may be the operator, never both absent. */
export interface ReviewRequester {
  kind: ReviewAuthorKind
  agentId: string | null
}

export interface ReviewPacket {
  id: string
  requester: ReviewRequester
  /** Null for an operator-only packet: nothing was delegated. */
  reviewerAgentId: string | null
  snapshot: { id: string; complete: boolean; head: string | null; baseOid: string }
  summary: string | null
  state: ReviewPacketState
  createdAt: number
  expiresAt: number
  /** Set only when an export was actually produced, and only for the revision it exported. */
  exportedAt: number | null
  exportRevision: string | null
}

export interface ReviewFinding {
  id: string
  path: string
  /** Context for a human, not identity: applicability is decided by the path and the revision. */
  lineStart: number | null
  lineEnd: number | null
  severity: ReviewSeverity
  note: string
  author: ReviewRequester
  /** The revision this finding was made against. */
  snapshotId: string
  state: ReviewFindingState
  resolution: {
    kind: ReviewResolutionKind
    note: string
    at: number
    by: ReviewRequester
  } | null
  createdAt: number
  /**
   * Per-path staleness for the *current* code. `unknown` means it could not be established, which is
   * different from "still applies" — and never a claim that the finding is fixed.
   */
  applicability: SnapshotComparison
}

export interface ReviewConclusionEntry {
  reviewer: ReviewRequester
  conclusion: ReviewConclusion
  note: string | null
  snapshotId: string
  createdAt: number
}

export interface ReviewAttempt {
  id: string
  attemptNumber: number
  state: 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain'
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

/**
 * The detail view: the packet, its findings, its reviewers' conclusions and how the current tree stands.
 *
 * Applicability is three-valued and never a badge. It shows that the source moved, not that a finding
 * was addressed.
 */
export interface ReviewPacketReport {
  packet: ReviewPacket
  findings: ReviewFinding[]
  conclusions: ReviewConclusionEntry[]
  attempts: ReviewAttempt[]
  applicability: {
    comparison: SnapshotComparison
    /** True when the reviewed revision is no longer the current tree, so the packet reads stale. */
    stale: boolean
  }
  /**
   * Completion facts, each shown only when its own evidence exists: preparing a change is not reviewing
   * it, a review is not acceptance, and neither is a commit or a deployment.
   */
  facts: ReviewCompletionFacts
}

export interface ReviewCompletionFacts {
  changePrepared: boolean
  checksCurrent: boolean
  reviewed: boolean
  /** Operator-reported external states, labelled as reported rather than verified. */
  reported: {
    committed: string | null
    pushed: string | null
    pullRequest: string | null
    merged: string | null
    deployed: string | null
    productionAccepted: string | null
  }
}

export interface ReviewPacketSummary {
  packet: ReviewPacket
  counts: { findings: number; unresolved: number; blockers: number }
  conclusion: ReviewConclusion | null
}

export interface ReviewPacketListResponse {
  packets: ReviewPacketSummary[]
}

export interface ReviewPacketResponse {
  report: ReviewPacketReport
}

/** Request body for creating a packet. Bounds are enforced by the daemon, not the caller. */
export interface CreateReviewPacketRequest {
  snapshotId: string
  /** Omit for an operator-only packet. A reviewer must be a live member of the same Team. */
  reviewerAgentId?: string | null
  summary?: string | null
}

export interface AddReviewFindingRequest {
  path: string
  severity: ReviewSeverity
  note: string
  lineStart?: number | null
  lineEnd?: number | null
}

export interface RecordReviewConclusionRequest {
  conclusion: ReviewConclusion
  note?: string | null
}

export interface ResolveReviewFindingRequest {
  resolutionKind: ReviewResolutionKind
  resolutionNote: string
}

/**
 * A handoff. The patch and the description describe **one** revision; `revision` names it so a consumer
 * can tell whether it matches what they are looking at.
 */
export interface ReviewExport {
  packetId: string
  revision: string
  snapshotId: string
  baseOid: string
  /** Unified diff of the reviewed revision, bounded. */
  patch: string
  patchTruncated: boolean
  /** Problem, resulting behaviour, verification and unresolved limitations. */
  handoff: string
  /** Unresolved findings, so a handoff cannot read as complete while issues are open. */
  unresolved: Array<{
    path: string
    severity: ReviewSeverity
    note: string
    applicability: SnapshotComparison
  }>
  /** Stated plainly, because a handoff is where overclaiming does the most damage. */
  limitations: string[]
}

/**
 * What a reviewer Agent is shown about a packet (BAZ-043 slice 6).
 *
 * Two things are deliberately separate here. The **changed-path list** comes from the capture and is
 * always available. The **content** is not: a manifest stores paths and digests, never bytes, so a patch
 * for the reviewed revision exists only while the working tree still matches the capture. A reviewer is
 * told which of the two it has rather than being handed the current tree as if it were the reviewed one.
 */
export interface ReviewPacketBrief {
  packetId: string
  summary: string | null
  snapshot: { id: string; complete: boolean; head: string | null; baseOid: string }
  /** Changed paths of the captured revision. Path and status only. */
  changes: Array<{ path: string; status: string; previousPath: string | null }>
  /** True while the reviewed revision's content can still be reproduced from the working tree. */
  contentAvailable: boolean
  /** Why content is unavailable, when it is. Never a substitute for the change list. */
  contentUnavailableReason: string | null
  /** Findings recorded so far, including the reviewer's own, so it does not repeat itself. */
  findings: Array<{
    id: string
    path: string
    severity: ReviewSeverity
    note: string
    authorKind: ReviewAuthorKind
  }>
  conclusion: ReviewConclusion | null
}

/** One changed path's patch, bounded. `reason` explains an empty result rather than implying none. */
export interface ReviewPathContent {
  path: string
  patch: string | null
  truncated: boolean
  reason: string | null
}

/** What a reviewer may submit. There is no field for a command, a file write or a publication. */
export interface ReviewFindingInput {
  path: string
  severity: ReviewSeverity
  note: string
  lineStart?: number | null
  lineEnd?: number | null
}

export interface ReviewConclusionInput {
  conclusion: ReviewConclusion
  note?: string | null
}
