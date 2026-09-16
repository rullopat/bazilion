import type { SnapshotComparison } from './git-review.ts'

// BAZ-044 wire shapes: one typed verification request handed to a selected same-Team specialist.
//
// Hermetic by design, like the rest of this package: these describe what crosses HTTP and IPC and
// nothing about how the daemon stores or dispatches it.

/**
 * Operator-visible state of one request.
 *
 * `uncertain` is a first-class outcome rather than a flavour of failure: an execution that was
 * interrupted did not report results, so its evidence proves nothing either way.
 */
export type VerificationRequestState =
  | 'pending'
  | 'awaiting_approval'
  | 'blocked'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain'

export type VerificationAttemptState =
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain'

/**
 * Outcome of one captured check.
 *
 * Successful exit, failed check, skipped, blocked, timed out, cancelled and interrupted stay
 * distinct. `unknown` is used when nothing trustworthy was recorded — a final chat sentence never
 * substitutes for it.
 */
export type VerificationCheckState =
  | 'not_executed'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'timed_out'
  | 'cancelled'
  | 'unknown'

/** Where a request came from. An operator request names no requester Agent. */
export type VerificationRequester = { kind: 'agent'; agentId: string } | { kind: 'operator' }

/** Bounded environment facts frozen at admission, from the BAZ-040 admitted environment. */
export interface VerificationEnvironmentFacts {
  image: string
  sandbox: 'off' | 'docker'
  cwd?: string
  env?: Record<string, string>
  /** Declared, bounded locations a check may write generated output to. */
  writablePaths?: string[]
}

/** One captured check: an exact command, cwd, purpose and timeout. Never arbitrary shell text. */
export interface VerificationCheckInput {
  command: string
  cwd: string
  purpose: string
  timeoutMs: number
}

export interface VerificationCheck extends VerificationCheckInput {
  ordinal: number
}

export interface VerificationRequest {
  id: string
  teamId: string
  requester: VerificationRequester
  recipientAgentId: string
  /** Canonical messaging identity when the request rode the peer message path. */
  messageId: string | null
  sourceSessionId: string | null
  snapshot: {
    id: string
    /** False when coverage was incomplete; an incomplete capture never authorizes execution. */
    complete: boolean
    head: string | null
    baseOid: string
  }
  environment: VerificationEnvironmentFacts
  summary: string | null
  state: VerificationRequestState
  createdAt: number
  expiresAt: number
}

export interface VerificationCheckOutcome {
  ordinal: number
  state: VerificationCheckState
  /** The BAZ-041 receipt that produced this outcome, for the states that executed. */
  commandId: string | null
  /**
   * True when the check executed but its receipt is no longer available (pruned or expired). Without
   * this an occupied `null` is indistinguishable from a check that never recorded a receipt.
   */
  receiptUnavailable: boolean
  exitCode: number | null
  startedAt: number | null
  finishedAt: number | null
}

/**
 * What the tree looked like after a verification's checks ran, relative to the capture.
 *
 * Declared output paths are **advisory**: they are validated at capture time and recorded, but they do not
 * confine a check. This is what keeps that honest — a check that wrote outside what it declared is
 * reported, so the declaration can be checked rather than assumed. `unknown` means it could not be
 * established, which is different from "nothing was written".
 */
export interface VerificationObservedWrites {
  comparison: SnapshotComparison
  /** Declared, Team-relative output paths across the attempt's checks. */
  declaredPaths: string[]
  observedPaths: string[]
  /** Observed paths no declared path covers — the check wrote somewhere it did not declare. */
  undeclaredPaths: string[]
  truncated: boolean
}

export interface VerificationAttempt {
  id: string
  attemptNumber: number
  /** Set on an explicit rerun: the attempt whose result this one supersedes. */
  supersedesAttemptId: string | null
  state: VerificationAttemptState
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  /**
   * Present once the attempt settled and the tree could be compared. Null while running, and on an
   * attempt that never ran anything.
   */
  observedWrites: VerificationObservedWrites | null
  outcomes: VerificationCheckOutcome[]
}

/**
 * Why a request could not be captured or executed.
 *
 * A blocker is a result, not an error to be smoothed over: unavailable inputs are reported rather
 * than substituted.
 */
export type VerificationBlockerReason =
  | 'snapshot_unavailable'
  | 'snapshot_incomplete'
  | 'snapshot_evidence_gone'
  | 'recipient_unavailable'
  | 'recipient_not_same_team'
  | 'requester_unavailable'
  | 'environment_unavailable'
  | 'workspace_busy'
  | 'workspace_mismatch'
  | 'source_changed'
  | 'check_not_captured'
  | 'approval_required'
  /** The edge no longer permits the request, so it must not run. */
  | 'policy_denied'
  /** The live workspace cannot be shown to match the captured change. */
  | 'source_unverifiable'
  | 'missing_toolchain'
  | 'unsupported'

export interface VerificationBlocker {
  reason: VerificationBlockerReason
  detail: string
}

/** Does this result still describe the current source? Never rendered as a pass. */
export interface VerificationApplicability {
  comparison: SnapshotComparison
  /** Absent when there is nothing to compare — reported as "not checked", never as unchanged. */
  testedSnapshotId: string | null
}

/** The full operator view of one request and its evidence. */
export interface VerificationReport {
  request: VerificationRequest
  checks: VerificationCheck[]
  attempts: VerificationAttempt[]
  applicability: VerificationApplicability
}

/**
 * One row of a list: the contract, its checks and its attempts.
 *
 * Applicability is deliberately absent. Establishing it means comparing the live tree against the
 * capture, so computing it per row would walk the repository once per request; the detail view asks for
 * it instead. A list therefore never implies that anything was checked.
 */
export interface VerificationSummary {
  request: VerificationRequest
  checks: VerificationCheck[]
  attempts: VerificationAttempt[]
}

export interface VerificationListResponse {
  requests: VerificationSummary[]
}

export interface VerificationResponse {
  request: VerificationReport
}

/** Request body for creating one request. Bounds are enforced by the daemon, not the caller. */
export interface CreateVerificationRequest {
  recipientAgentId: string
  snapshotId: string
  checks: VerificationCheckInput[]
  summary?: string | null
  sourceSessionId?: string | null
  /** Declared locations a check may write generated output to. */
  writablePaths?: string[]
}

/** Response for a capture that could not proceed: a blocker, never a partial request. */
export interface VerificationBlockedResponse {
  blocked: VerificationBlocker
}
