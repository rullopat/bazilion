import { randomUUID } from 'node:crypto'
import { type BazilionDb, inTx } from '../db/client.ts'

// BAZ-044: one typed, snapshot-bound verification request handed to a selected same-Team specialist.
//
// Narrow by design. A request binds exactly one immutable change (a BAZ-042 snapshot) to at most
// eight captured commands and the BAZ-040 admitted environment, and it names one recipient. There
// are no stages, transformations, approver assignments or automatic retries, and this is not
// another runs/events layer: Pi's session JSONL stays the transcript.
//
// Two properties are load-bearing and are the reason this lives in one module:
//
//   1. **One dispatch owner.** Claiming an attempt is transactional and leased, so exactly one
//      path runs a request. A claim left behind by a restart becomes `uncertain` and is never
//      automatically replayed — only an explicit rerun creates a new attempt, linked to the result
//      it supersedes.
//   2. **Executor facts are not model claims.** Check outcomes and exit codes are written only by
//      the executing boundary; a tester's interpretation never writes them.

/** Requests, their checks and their attempts are retained for seven days. */
export const VERIFICATION_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The refinement decision: up to eight exact task-selected commands. */
export const VERIFICATION_MAX_CHECKS = 8

/** Bounds mirroring the schema, enforced here so a caller gets a reason rather than a CHECK error. */
export const VERIFICATION_LIMITS = {
  command: 2_000,
  cwd: 1_000,
  purpose: 500,
  summary: 2_000,
  error: 2_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 300_000,
} as const

export type VerificationRequesterKind = 'agent' | 'operator'

/**
 * Operator-visible request state.
 *
 * `uncertain` is a real outcome, not a failure: evidence from an interrupted execution cannot be
 * trusted either way, so it is never reported as a result and never silently retried.
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

export type VerificationCheckState =
  | 'not_executed'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'timed_out'
  | 'cancelled'
  | 'unknown'

export type VerificationAttemptState =
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'uncertain'

export const VERIFICATION_TERMINAL_REQUEST_STATES: readonly VerificationRequestState[] = [
  'completed',
  'failed',
  'cancelled',
  'uncertain',
]

/** The selected specialist sees exactly these environment facts; nothing is inferred from a Profile. */
export interface VerificationEnvironment {
  /** BAZ-040 admitted image, `docker` posture included where Docker is the shell backend. */
  image: string
  sandbox: 'off' | 'docker'
  cwd?: string
  env?: Record<string, string>
  /** Named, bounded locations a check may write generated output to. */
  writablePaths?: string[]
}

export interface VerificationCheckInput {
  command: string
  cwd: string
  purpose: string
  timeoutMs: number
}

export interface VerificationRequestInput {
  id?: string
  teamId: string
  requesterKind: VerificationRequesterKind
  requesterAgentId: string | null
  recipientAgentId: string
  messageId?: string | null
  sourceSessionId?: string | null
  snapshotId: string
  snapshotComplete: boolean
  head: string | null
  baseOid: string
  environment: VerificationEnvironment
  summary?: string | null
  checks: readonly VerificationCheckInput[]
  now?: number
}

export interface VerificationRequestRecord {
  id: string
  teamId: string
  requesterKind: VerificationRequesterKind
  requesterAgentId: string | null
  recipientAgentId: string
  messageId: string | null
  sourceSessionId: string | null
  snapshotId: string
  snapshotComplete: boolean
  head: string | null
  baseOid: string
  environment: VerificationEnvironment
  summary: string | null
  state: VerificationRequestState
  createdAt: number
  expiresAt: number
}

export interface VerificationCheckRecord extends VerificationCheckInput {
  requestId: string
  ordinal: number
}

/** One executor-owned outcome for one declared check on one attempt. */
export interface VerificationCheckOutcomeRecord {
  attemptId: string
  ordinal: number
  state: VerificationCheckState
  commandId: string | null
  exitCode: number | null
  startedAt: number | null
  finishedAt: number | null
}

export interface VerificationAttemptRecord {
  id: string
  requestId: string
  attemptNumber: number
  supersedesAttemptId: string | null
  state: VerificationAttemptState
  leaseOwner: string | null
  leaseExpiresAt: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  createdAt: number
}

/** Ownership evidence for one dispatch. Only the host that claimed it may finish it. */
export interface VerificationClaim {
  attempt: VerificationAttemptRecord
  /** The request state this claim installed, for a caller that must also observe it. */
  state: VerificationRequestState
}

interface RequestRow {
  id: string
  team_id: string
  requester_kind: string
  requester_agent_id: string | null
  recipient_agent_id: string
  message_id: string | null
  source_session_id: string | null
  snapshot_id: string
  snapshot_complete: number
  head: string | null
  base_oid: string
  environment_json: string
  summary: string | null
  state: string
  created_at: number
  expires_at: number
}

interface CheckRow {
  request_id: string
  ordinal: number
  command: string
  cwd: string
  purpose: string
  timeout_ms: number
}

interface OutcomeRow {
  attempt_id: string
  ordinal: number
  state: string
  command_id: string | null
  exit_code: number | null
  started_at: number | null
  finished_at: number | null
}

interface AttemptRow {
  id: string
  request_id: string
  attempt_number: number
  supersedes_attempt_id: string | null
  state: string
  lease_owner: string | null
  lease_expires_at: number | null
  started_at: number | null
  finished_at: number | null
  error: string | null
  created_at: number
}

const REQUEST_COLUMNS =
  'id, team_id, requester_kind, requester_agent_id, recipient_agent_id, message_id, ' +
  'source_session_id, snapshot_id, snapshot_complete, head, base_oid, environment_json, summary, ' +
  'state, created_at, expires_at'

const CHECK_COLUMNS = 'request_id, ordinal, command, cwd, purpose, timeout_ms'

const OUTCOME_COLUMNS = 'attempt_id, ordinal, state, command_id, exit_code, started_at, finished_at'

const ATTEMPT_COLUMNS =
  'id, request_id, attempt_number, supersedes_attempt_id, state, lease_owner, lease_expires_at, ' +
  'started_at, finished_at, error, created_at'

function toRequest(row: RequestRow): VerificationRequestRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    requesterKind: row.requester_kind === 'agent' ? 'agent' : 'operator',
    requesterAgentId: row.requester_agent_id,
    recipientAgentId: row.recipient_agent_id,
    messageId: row.message_id,
    sourceSessionId: row.source_session_id,
    snapshotId: row.snapshot_id,
    snapshotComplete: row.snapshot_complete === 1,
    head: row.head,
    baseOid: row.base_oid,
    environment: JSON.parse(row.environment_json) as VerificationEnvironment,
    summary: row.summary,
    state: row.state as VerificationRequestState,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function toCheck(row: CheckRow): VerificationCheckRecord {
  return {
    requestId: row.request_id,
    ordinal: row.ordinal,
    command: row.command,
    cwd: row.cwd,
    purpose: row.purpose,
    timeoutMs: row.timeout_ms,
  }
}

function toOutcome(row: OutcomeRow): VerificationCheckOutcomeRecord {
  return {
    attemptId: row.attempt_id,
    ordinal: row.ordinal,
    state: row.state as VerificationCheckState,
    commandId: row.command_id,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function toAttempt(row: AttemptRow): VerificationAttemptRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    supersedesAttemptId: row.supersedes_attempt_id,
    state: row.state as VerificationAttemptState,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    createdAt: row.created_at,
  }
}

export class VerificationRequestError extends Error {
  readonly status = 400
}

/** The addressed request is unknown, expired, or inside another Team. All three mean the same. */
export class VerificationRequestNotFoundError extends Error {
  readonly status = 404
  constructor() {
    super('verification request not found')
  }
}

/**
 * Create one request and its captured checks atomically.
 *
 * Bounds are checked before anything is written, so an accepted request is one the rest of the
 * system can execute without reinterpreting it.
 */
export function createVerificationRequest(
  db: BazilionDb,
  input: VerificationRequestInput,
): VerificationRequestRecord {
  const now = input.now ?? Date.now()
  const id = input.id ?? randomUUID()
  if (input.checks.length < 1)
    throw new VerificationRequestError('a request needs at least one check')
  if (input.checks.length > VERIFICATION_MAX_CHECKS) {
    throw new VerificationRequestError(
      `a request captures at most ${VERIFICATION_MAX_CHECKS} checks`,
    )
  }
  for (const check of input.checks) validateCheck(check)
  validateEnvironment(input.environment)
  if (input.summary != null) {
    if (!input.summary.trim()) throw new VerificationRequestError('a summary must not be empty')
    assertLength(input.summary, VERIFICATION_LIMITS.summary, 'summary')
  }
  if (!input.snapshotId)
    throw new VerificationRequestError('a request requires a captured snapshot')
  if (!input.baseOid) throw new VerificationRequestError('a request requires a captured base')
  if (input.requesterKind === 'agent') {
    if (!input.requesterAgentId)
      throw new VerificationRequestError('an Agent request names its requester')
    if (input.requesterAgentId === input.recipientAgentId) {
      throw new VerificationRequestError('a specialist cannot verify its own request')
    }
  } else if (input.requesterAgentId) {
    throw new VerificationRequestError('an operator request has no requester Agent')
  }

  return inTx(db, () => {
    db.raw.run(
      `INSERT INTO verification_requests (${REQUEST_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        input.teamId,
        input.requesterKind,
        input.requesterAgentId,
        input.recipientAgentId,
        input.messageId ?? null,
        input.sourceSessionId ?? null,
        input.snapshotId,
        input.snapshotComplete ? 1 : 0,
        input.head,
        input.baseOid,
        JSON.stringify(input.environment),
        input.summary ?? null,
        now,
        now + VERIFICATION_REQUEST_TTL_MS,
      ],
    )
    input.checks.forEach((check, ordinal) => {
      db.raw.run(
        `INSERT INTO verification_checks (request_id, ordinal, command, cwd, purpose, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, ordinal, check.command, check.cwd, check.purpose, check.timeoutMs],
      )
    })
    const request = getVerificationRequest(db, input.teamId, id, now)
    if (!request) throw new VerificationRequestError('request was not stored')
    return request
  })
}

/**
 * Read one request inside its Team.
 *
 * An expired request reads as absent: its evidence window closed, so it is never served as a
 * usable contract.
 */
export function getVerificationRequest(
  db: BazilionDb,
  teamId: string,
  id: string,
  now = Date.now(),
): VerificationRequestRecord | null {
  const row = db.raw
    .query<RequestRow, [string, string, number]>(
      `SELECT ${REQUEST_COLUMNS} FROM verification_requests
       WHERE team_id = ? AND id = ? AND expires_at > ?`,
    )
    .get(teamId, id, now)
  return row ? toRequest(row) : null
}

/** Read by id alone (dispatch paths already hold a Team-scoped reference). */
export function getVerificationRequestById(
  db: BazilionDb,
  id: string,
  now = Date.now(),
): VerificationRequestRecord | null {
  const row = db.raw
    .query<RequestRow, [string, number]>(
      `SELECT ${REQUEST_COLUMNS} FROM verification_requests WHERE id = ? AND expires_at > ?`,
    )
    .get(id, now)
  return row ? toRequest(row) : null
}

export function listVerificationRequests(
  db: BazilionDb,
  teamId: string,
  limit = 50,
  now = Date.now(),
): VerificationRequestRecord[] {
  return db.raw
    .query<RequestRow, [string, number, number]>(
      `SELECT ${REQUEST_COLUMNS} FROM verification_requests
       WHERE team_id = ? AND expires_at > ?
       ORDER BY created_at DESC, id LIMIT ?`,
    )
    .all(teamId, now, limit)
    .map(toRequest)
}

export function listVerificationChecks(
  db: BazilionDb,
  requestId: string,
): VerificationCheckRecord[] {
  return db.raw
    .query<CheckRow, [string]>(
      `SELECT ${CHECK_COLUMNS} FROM verification_checks WHERE request_id = ? ORDER BY ordinal`,
    )
    .all(requestId)
    .map(toCheck)
}

/** Outcomes recorded for one attempt, in declared order. */
export function listVerificationCheckOutcomes(
  db: BazilionDb,
  attemptId: string,
): VerificationCheckOutcomeRecord[] {
  return db.raw
    .query<OutcomeRow, [string]>(
      `SELECT ${OUTCOME_COLUMNS} FROM verification_check_outcomes WHERE attempt_id = ?
       ORDER BY ordinal`,
    )
    .all(attemptId)
    .map(toOutcome)
}

export function listVerificationAttempts(
  db: BazilionDb,
  requestId: string,
): VerificationAttemptRecord[] {
  return db.raw
    .query<AttemptRow, [string]>(
      `SELECT ${ATTEMPT_COLUMNS} FROM verification_attempts WHERE request_id = ?
       ORDER BY attempt_number`,
    )
    .all(requestId)
    .map(toAttempt)
}

/**
 * Claim the single execution slot for a request.
 *
 * Returns null when someone else owns it, when the request already reached a terminal state, or
 * when it is still held for approval — in every case the caller has nothing to execute. A claim is
 * persisted before any command runs, which is what makes an interrupted execution recoverable as
 * `uncertain` rather than replayable.
 */
export function claimVerificationAttempt(
  db: BazilionDb,
  input: {
    requestId: string
    leaseOwner: string
    leaseMs: number
    /** Set only for an explicit operator rerun of a finished request. */
    rerun?: boolean
    now?: number
  },
): VerificationClaim | null {
  const now = input.now ?? Date.now()
  if (!input.leaseOwner) throw new VerificationRequestError('a claim requires an owner')
  if (input.leaseMs <= 0) throw new VerificationRequestError('a claim requires a positive lease')
  return inTx(db, () => {
    const row = db.raw
      .query<RequestRow, [string, number]>(
        `SELECT ${REQUEST_COLUMNS} FROM verification_requests WHERE id = ? AND expires_at > ?`,
      )
      .get(input.requestId, now)
    if (!row) return null
    const request = toRequest(row)
    const terminal = VERIFICATION_TERMINAL_REQUEST_STATES.includes(request.state)
    if (!terminal && request.state !== 'pending') return null
    if (terminal && !input.rerun) return null
    const open = db.raw
      .query<{ id: string }, [string]>(
        'SELECT id FROM verification_attempts WHERE request_id = ? AND finished_at IS NULL',
      )
      .get(input.requestId)
    if (open) return null
    const previous = db.raw
      .query<{ id: string; attempt_number: number }, [string]>(
        `SELECT id, attempt_number FROM verification_attempts WHERE request_id = ?
         ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(input.requestId)
    const attemptId = randomUUID()
    db.raw.run(
      `INSERT INTO verification_attempts
        (id, request_id, attempt_number, supersedes_attempt_id, state, lease_owner,
         lease_expires_at, created_at)
       VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?)`,
      [
        attemptId,
        input.requestId,
        (previous?.attempt_number ?? 0) + 1,
        previous?.id ?? null,
        input.leaseOwner,
        now + input.leaseMs,
        now,
      ],
    )
    db.raw.run(
      `INSERT INTO verification_check_outcomes (attempt_id, ordinal, state)
       SELECT ?, ordinal, 'not_executed' FROM verification_checks WHERE request_id = ?`,
      [attemptId, input.requestId],
    )
    setRequestState(db, input.requestId, 'running')
    const attempt = db.raw
      .query<AttemptRow, [string]>(
        `SELECT ${ATTEMPT_COLUMNS} FROM verification_attempts WHERE id = ?`,
      )
      .get(attemptId)
    if (!attempt) throw new VerificationRequestError('attempt was not stored')
    return { attempt: toAttempt(attempt), state: 'running' }
  })
}

/** Mark a claimed attempt as having started its checks; only the lease owner may. */
export function startVerificationAttempt(
  db: BazilionDb,
  attemptId: string,
  leaseOwner: string,
  now = Date.now(),
): boolean {
  const result = db.raw.run(
    `UPDATE verification_attempts SET state = 'running', started_at = ?
     WHERE id = ? AND lease_owner = ? AND state = 'claimed'`,
    [now, attemptId, leaseOwner],
  )
  return Number(result.changes) === 1
}

/**
 * Finish an attempt and settle the request.
 *
 * A lease that expired or was taken over by recovery cannot be finished: the caller must not
 * overwrite a newer owner's work.
 */
export function finishVerificationAttempt(
  db: BazilionDb,
  input: {
    attemptId: string
    leaseOwner: string
    state: Exclude<VerificationAttemptState, 'claimed' | 'running'>
    error?: string | null
    now?: number
  },
): boolean {
  const now = input.now ?? Date.now()
  if (input.error != null) assertLength(input.error, VERIFICATION_LIMITS.error, 'error')
  return inTx(db, () => {
    const row = db.raw
      .query<AttemptRow, [string, string]>(
        `SELECT ${ATTEMPT_COLUMNS} FROM verification_attempts WHERE id = ? AND lease_owner = ?`,
      )
      .get(input.attemptId, input.leaseOwner)
    if (!row) return false
    const attempt = toAttempt(row)
    if (attempt.finishedAt !== null) return false
    db.raw.run(
      `UPDATE verification_attempts
       SET state = ?, finished_at = ?, lease_owner = NULL, lease_expires_at = NULL, error = ?
       WHERE id = ?`,
      [input.state, now, input.error ?? null, input.attemptId],
    )
    setRequestState(db, attempt.requestId, input.state === 'uncertain' ? 'uncertain' : input.state)
    return true
  })
}

export function setRequestState(
  db: BazilionDb,
  requestId: string,
  state: VerificationRequestState,
): void {
  db.raw.run('UPDATE verification_requests SET state = ? WHERE id = ?', [state, requestId])
}

/**
 * Record an executor-owned check outcome.
 *
 * This is the only writer of `command_id`/`exit_code`, and it refuses to touch a check that was
 * already settled, so an outcome cannot be revised after the fact by anyone — including a retry.
 */
export function recordVerificationCheckOutcome(
  db: BazilionDb,
  input: {
    attemptId: string
    ordinal: number
    state: VerificationCheckState
    commandId?: string | null
    exitCode?: number | null
    startedAt?: number | null
    finishedAt?: number | null
  },
): boolean {
  if (input.state === 'not_executed') {
    throw new VerificationRequestError('a settled outcome cannot return to not_executed')
  }
  const executed = ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(input.state)
  if (executed && !input.commandId) {
    throw new VerificationRequestError(`${input.state} requires the receipt that produced it`)
  }
  if (!executed && input.commandId) {
    throw new VerificationRequestError(`${input.state} cannot claim a command receipt`)
  }
  if (input.exitCode != null && input.state !== 'succeeded' && input.state !== 'failed') {
    throw new VerificationRequestError('only an executed check records an exit code')
  }
  const attempt = db.raw
    .query<{ request_id: string }, [string]>(
      'SELECT request_id FROM verification_attempts WHERE id = ?',
    )
    .get(input.attemptId)
  if (!attempt) return false
  const result = db.raw.run(
    `UPDATE verification_check_outcomes
     SET state = ?, command_id = ?, exit_code = ?, started_at = ?, finished_at = ?
     WHERE attempt_id = ? AND ordinal = ? AND state = 'not_executed'
       AND EXISTS (SELECT 1 FROM verification_checks
                   WHERE request_id = ? AND ordinal = ?)`,
    [
      input.state,
      input.commandId ?? null,
      input.exitCode ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? Date.now(),
      input.attemptId,
      input.ordinal,
      attempt.request_id,
      input.ordinal,
    ],
  )
  return Number(result.changes) === 1
}

/**
 * Settle every claim left by another daemon process.
 *
 * The work may or may not have happened, so the only honest outcome is `uncertain`. Nothing is
 * replayed, and the request is not returned to `pending`.
 */
export function recoverInterruptedVerificationAttempts(
  db: BazilionDb,
  daemonIdentity: string,
  now = Date.now(),
): string[] {
  return inTx(db, () => {
    const rows = db.raw
      .query<{ id: string; request_id: string; lease_owner: string | null }, []>(
        `SELECT id, request_id, lease_owner FROM verification_attempts WHERE finished_at IS NULL`,
      )
      .all()
    const recovered: string[] = []
    for (const row of rows) {
      if (row.lease_owner === daemonIdentity) continue
      db.raw.run(
        `UPDATE verification_attempts
         SET state = 'uncertain', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL,
             error = 'execution was interrupted before it reported an outcome'
         WHERE id = ?`,
        [now, row.id],
      )
      db.raw.run(
        `UPDATE verification_check_outcomes SET state = 'unknown', finished_at = ?
         WHERE attempt_id = ? AND state = 'not_executed'`,
        [now, row.id],
      )
      setRequestState(db, row.request_id, 'uncertain')
      recovered.push(row.request_id)
    }
    return recovered
  })
}

/** Drop requests past their window, cascading checks and attempts. */
export function pruneVerificationRequests(db: BazilionDb, now = Date.now()): number {
  const result = db.raw.run('DELETE FROM verification_requests WHERE expires_at <= ?', [now])
  return Number(result.changes)
}

function validateCheck(check: VerificationCheckInput): void {
  if (!check.command.trim()) throw new VerificationRequestError('a check requires a command')
  assertLength(check.command, VERIFICATION_LIMITS.command, 'command')
  if (check.cwd.length > VERIFICATION_LIMITS.cwd) {
    throw new VerificationRequestError('cwd is outside its bounded contract')
  }
  if (!check.purpose.trim()) throw new VerificationRequestError('a check requires a purpose')
  assertLength(check.purpose, VERIFICATION_LIMITS.purpose, 'purpose')
  if (
    !Number.isInteger(check.timeoutMs) ||
    check.timeoutMs < VERIFICATION_LIMITS.minTimeoutMs ||
    check.timeoutMs > VERIFICATION_LIMITS.maxTimeoutMs
  ) {
    throw new VerificationRequestError('timeout is outside its bounded contract')
  }
}

function validateEnvironment(environment: VerificationEnvironment): void {
  if (!environment.image)
    throw new VerificationRequestError('the admitted environment has no image')
  if (environment.sandbox !== 'off' && environment.sandbox !== 'docker') {
    throw new VerificationRequestError('the admitted environment has an unknown shell backend')
  }
  if (environment.env && Object.keys(environment.env).length > 32) {
    throw new VerificationRequestError('the admitted environment carries too many variables')
  }
}

function assertLength(value: string, limit: number, field: string): void {
  if (Buffer.byteLength(value) > limit) {
    throw new VerificationRequestError(`${field} is outside its bounded contract`)
  }
}
