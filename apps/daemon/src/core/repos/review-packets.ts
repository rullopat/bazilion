import { randomUUID } from 'node:crypto'
import type { ReviewConclusion, ReviewSeverity } from '@bazilion/api-types'
import { type BazilionDb, inTx } from '../db/client.ts'

// BAZ-043: one revision-bound review packet, its findings and its conclusion.
//
// Three properties are load-bearing here, and they are why this lives in one module:
//
//   1. **The captured contract is immutable.** A packet names one BAZ-042 snapshot. Editing the
//      repository afterwards does not rewrite the packet — it makes the packet's current-code status
//      stale, which is a fact clients read rather than a reason to re-capture silently.
//   2. **Findings are append-only and resolution is explicit.** A finding is about one path in one
//      revision; `resolved` requires an explicit decision or a named later revision, because a changed
//      line number cannot prove an issue was fixed. `unverified` is a real state, not a failure.
//   3. **Reviewer dispatch is leased once.** Exactly one owner reviews a packet; a claim left behind by
//      an interrupted process becomes `uncertain` and is never replayed.

/** Packets, findings and conclusions are retained for seven days, like the evidence they reference. */
export const REVIEW_PACKET_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const REVIEW_LIMITS = {
  summary: 2_000,
  note: 4_000,
  path: 1_000,
  /** Findings per packet: a review is a bounded set, not a comment stream. */
  findings: 200,
} as const

export type ReviewPacketState =
  | 'open'
  | 'awaiting_approval'
  | 'blocked'
  | 'reviewing'
  | 'reviewed'
  | 'cancelled'

export type ReviewFindingState = 'open' | 'unverified' | 'resolved'
export type ReviewResolutionKind = 'explicit' | 'linked_revision'

/** The closed set of external states an operator may report. Nothing here is verified. */
export const REVIEW_REPORTED_STATES = [
  'committed',
  'pushed',
  'pullRequest',
  'merged',
  'deployed',
  'productionAccepted',
] as const

export type ReviewReportedState = (typeof REVIEW_REPORTED_STATES)[number]
export type ReviewReportedStates = Record<ReviewReportedState, string | null>

export interface ReviewPacketRecord {
  id: string
  teamId: string
  requesterKind: 'agent' | 'operator'
  requesterAgentId: string | null
  reviewerAgentId: string | null
  snapshotId: string
  snapshotComplete: boolean
  head: string | null
  baseOid: string
  summary: string | null
  state: ReviewPacketState
  exportedAt: number | null
  exportRevision: string | null
  /** Operator-reported external states. Null means unset; the daemon never infers one. */
  reported: ReviewReportedStates
  createdAt: number
  expiresAt: number
}

export interface ReviewFindingRow {
  id: string
  packetId: string
  authorKind: 'agent' | 'operator'
  authorAgentId: string | null
  path: string
  lineStart: number | null
  lineEnd: number | null
  severity: ReviewSeverity
  note: string
  snapshotId: string
  state: ReviewFindingState
  resolutionKind: ReviewResolutionKind | null
  resolutionNote: string | null
  resolvedAt: number | null
  resolvedByKind: 'agent' | 'operator' | null
  resolvedByAgentId: string | null
  createdAt: number
}

export interface ReviewConclusionRow {
  id: string
  packetId: string
  reviewerKind: 'agent' | 'operator'
  reviewerAgentId: string | null
  conclusion: ReviewConclusion
  note: string | null
  snapshotId: string
  createdAt: number
}

export interface ReviewAttemptRecord {
  id: string
  packetId: string
  attemptNumber: number
  supersedesAttemptId: string | null
  state: 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain'
  leaseOwner: string | null
  leaseExpiresAt: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  createdAt: number
}

export class ReviewPacketError extends Error {
  constructor(
    readonly code:
      | 'packet_not_found'
      | 'packet_closed'
      | 'finding_limit'
      | 'finding_not_found'
      | 'invalid_resolution',
    message: string,
  ) {
    super(message)
  }
}

function assertLength(value: string, max: number, field: string): void {
  if (Buffer.byteLength(value) > max)
    throw new ReviewPacketError('finding_limit', `${field} is too long`)
}

export function createReviewPacket(
  db: BazilionDb,
  input: {
    teamId: string
    requesterKind: 'agent' | 'operator'
    requesterAgentId?: string | null
    /** Null for an operator-only packet: nothing is delegated, so nothing is dispatched. */
    reviewerAgentId: string | null
    snapshotId: string
    snapshotComplete: boolean
    head: string | null
    baseOid: string
    summary?: string | null
    now?: number
  },
): ReviewPacketRecord {
  const now = input.now ?? Date.now()
  const id = randomUUID()
  if (input.summary) assertLength(input.summary, REVIEW_LIMITS.summary, 'summary')
  db.raw.run(
    `INSERT INTO review_packets (
       id, team_id, requester_kind, requester_agent_id, reviewer_agent_id, snapshot_id,
       snapshot_complete, head, base_oid, summary, state, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
      id,
      input.teamId,
      input.requesterKind,
      input.requesterAgentId ?? null,
      input.reviewerAgentId,
      input.snapshotId,
      input.snapshotComplete ? 1 : 0,
      input.head,
      input.baseOid,
      input.summary ?? null,
      now,
      now + REVIEW_PACKET_TTL_MS,
    ],
  )
  const created = getReviewPacket(db, id)
  if (!created) throw new ReviewPacketError('packet_not_found', 'the packet could not be read back')
  return created
}

/** Read by id alone: dispatch paths already hold a Team-scoped reference. */
export function getReviewPacket(
  db: BazilionDb,
  id: string,
  now = Date.now(),
): ReviewPacketRecord | null {
  const row = db.raw
    .query<PacketRow, [string, number]>(
      `SELECT ${PACKET_COLUMNS} FROM review_packets WHERE id = ? AND expires_at > ?`,
    )
    .get(id, now)
  return row ? toPacket(row) : null
}

export function getTeamReviewPacket(
  db: BazilionDb,
  teamId: string,
  id: string,
  now = Date.now(),
): ReviewPacketRecord | null {
  const row = db.raw
    .query<PacketRow, [string, string, number]>(
      `SELECT ${PACKET_COLUMNS} FROM review_packets WHERE id = ? AND team_id = ? AND expires_at > ?`,
    )
    .get(id, teamId, now)
  return row ? toPacket(row) : null
}

export function listReviewPackets(
  db: BazilionDb,
  teamId: string,
  limit = 50,
  now = Date.now(),
): ReviewPacketRecord[] {
  return db.raw
    .query<PacketRow, [string, number, number]>(
      `SELECT ${PACKET_COLUMNS} FROM review_packets
       WHERE team_id = ? AND expires_at > ?
       ORDER BY created_at DESC, id LIMIT ?`,
    )
    .all(teamId, now, limit)
    .map(toPacket)
}

/**
 * Packets waiting for their reviewer, oldest first.
 *
 * `open` only: a packet in `awaiting_approval` is held by the policy boundary, not by the reviewer, and
 * dispatching it early would run a review the policy has not released.
 */
export function listDispatchableReviewPackets(
  db: BazilionDb,
  now = Date.now(),
): ReviewPacketRecord[] {
  return db.raw
    .query<PacketRow, [number]>(
      `SELECT ${PACKET_COLUMNS} FROM review_packets
       WHERE state = 'open' AND reviewer_agent_id IS NOT NULL AND expires_at > ?
       ORDER BY created_at ASC, id`,
    )
    .all(now)
    .map(toPacket)
}

export function setReviewPacketState(
  db: BazilionDb,
  packetId: string,
  state: ReviewPacketState,
): boolean {
  const result = db.raw.run('UPDATE review_packets SET state = ? WHERE id = ?', [state, packetId])
  return Number(result.changes) > 0
}

/** Record an export only for the revision it was made from. A later revision cannot inherit it. */
export function recordReviewExport(
  db: BazilionDb,
  packetId: string,
  revision: string,
  now = Date.now(),
): boolean {
  const result = db.raw.run(
    'UPDATE review_packets SET exported_at = ?, export_revision = ? WHERE id = ?',
    [now, revision, packetId],
  )
  return Number(result.changes) > 0
}

/**
 * Add one finding. Append-only: nothing here updates or deletes a finding's evidence, and the author is
 * recorded as given so an operator finding and an Agent finding stay distinguishable.
 */
export function addReviewFinding(
  db: BazilionDb,
  input: {
    packetId: string
    authorKind: 'agent' | 'operator'
    authorAgentId?: string | null
    path: string
    lineStart?: number | null
    lineEnd?: number | null
    severity: ReviewSeverity
    note: string
    snapshotId: string
    /** `unverified` when the finding could not be correlated to the captured revision. */
    state?: ReviewFindingState
    now?: number
  },
): ReviewFindingRow {
  assertLength(input.path, REVIEW_LIMITS.path, 'path')
  assertLength(input.note, REVIEW_LIMITS.note, 'note')
  if (input.note.trim() === '') {
    throw new ReviewPacketError('invalid_resolution', 'a finding needs a note')
  }
  return inTx(db, () => {
    const count = db.raw
      .query<{ n: number }, [string]>(
        'SELECT count(*) AS n FROM review_findings WHERE packet_id = ?',
      )
      .get(input.packetId)?.n
    if ((count ?? 0) >= REVIEW_LIMITS.findings) {
      throw new ReviewPacketError(
        'finding_limit',
        `a packet holds at most ${REVIEW_LIMITS.findings} findings`,
      )
    }
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO review_findings (
         id, packet_id, author_kind, author_agent_id, path, line_start, line_end, severity, note,
         snapshot_id, state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.packetId,
        input.authorKind,
        input.authorAgentId ?? null,
        input.path,
        input.lineStart ?? null,
        input.lineEnd ?? null,
        input.severity,
        input.note,
        input.snapshotId,
        input.state ?? 'open',
        input.now ?? Date.now(),
      ],
    )
    const row = getReviewFinding(db, id)
    if (!row) throw new ReviewPacketError('finding_not_found', 'the finding could not be read back')
    return row
  })
}

export function getReviewFinding(db: BazilionDb, id: string): ReviewFindingRow | null {
  const row = db.raw
    .query<FindingRow, [string]>(`SELECT ${FINDING_COLUMNS} FROM review_findings WHERE id = ?`)
    .get(id)
  return row ? toFinding(row) : null
}

export function listReviewFindings(db: BazilionDb, packetId: string): ReviewFindingRow[] {
  return db.raw
    .query<FindingRow, [string]>(
      `SELECT ${FINDING_COLUMNS} FROM review_findings WHERE packet_id = ? ORDER BY created_at, rowid`,
    )
    .all(packetId)
    .map(toFinding)
}

/**
 * Resolve a finding — with proof, not with an assumption.
 *
 * Allowed only from `open`: an `unverified` finding was never correlated to this packet's revision, so
 * resolving it would attach a decision to evidence nobody established. The caller supplies the proof:
 * `explicit` for a decision, or `linked_revision` naming the revision that is claimed to fix it.
 */
export function resolveReviewFinding(
  db: BazilionDb,
  input: {
    findingId: string
    resolutionKind: ReviewResolutionKind
    resolutionNote: string
    resolvedByKind: 'agent' | 'operator'
    resolvedByAgentId?: string | null
    now?: number
  },
): ReviewFindingRow {
  const finding = getReviewFinding(db, input.findingId)
  if (!finding) throw new ReviewPacketError('finding_not_found', 'the finding does not exist')
  if (finding.state !== 'open') {
    throw new ReviewPacketError(
      'invalid_resolution',
      finding.state === 'resolved'
        ? 'the finding is already resolved'
        : 'an unverified finding cannot be resolved: it was never correlated to the reviewed revision',
    )
  }
  if (input.resolutionNote.trim() === '') {
    throw new ReviewPacketError('invalid_resolution', 'resolving a finding needs a note saying how')
  }
  assertLength(input.resolutionNote, REVIEW_LIMITS.summary, 'resolution note')
  const now = input.now ?? Date.now()
  db.raw.run(
    `UPDATE review_findings
     SET state = 'resolved', resolution_kind = ?, resolution_note = ?, resolved_at = ?,
         resolved_by_kind = ?, resolved_by_agent_id = ?
     WHERE id = ? AND state = 'open'`,
    [
      input.resolutionKind,
      input.resolutionNote,
      now,
      input.resolvedByKind,
      input.resolvedByAgentId ?? null,
      input.findingId,
    ],
  )
  const updated = getReviewFinding(db, input.findingId)
  if (!updated) throw new ReviewPacketError('finding_not_found', 'the finding disappeared')
  return updated
}

/** One conclusion per reviewer per packet: a second conclusion replaces the reviewer's own. */
export function recordReviewConclusion(
  db: BazilionDb,
  input: {
    packetId: string
    reviewerKind: 'agent' | 'operator'
    reviewerAgentId?: string | null
    conclusion: ReviewConclusion
    note?: string | null
    snapshotId: string
    now?: number
  },
): ReviewConclusionRow {
  if (input.note) assertLength(input.note, REVIEW_LIMITS.note, 'conclusion note')
  const id = randomUUID()
  db.raw.run(
    `INSERT INTO review_conclusions (
       id, packet_id, reviewer_kind, reviewer_agent_id, conclusion, note, snapshot_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (packet_id, reviewer_kind, reviewer_agent_id) DO UPDATE SET
       conclusion = excluded.conclusion,
       note = excluded.note,
       snapshot_id = excluded.snapshot_id,
       created_at = excluded.created_at`,
    [
      id,
      input.packetId,
      input.reviewerKind,
      input.reviewerAgentId ?? null,
      input.conclusion,
      input.note ?? null,
      input.snapshotId,
      input.now ?? Date.now(),
    ],
  )
  const row = db.raw
    .query<ConclusionRow, [string, string, string | null]>(
      `SELECT ${CONCLUSION_COLUMNS} FROM review_conclusions
       WHERE packet_id = ? AND reviewer_kind = ? AND reviewer_agent_id IS ?`,
    )
    .get(input.packetId, input.reviewerKind, input.reviewerAgentId ?? null)
  if (!row) throw new ReviewPacketError('packet_not_found', 'the conclusion could not be read back')
  return toConclusion(row)
}

export function listReviewConclusions(db: BazilionDb, packetId: string): ReviewConclusionRow[] {
  return db.raw
    .query<ConclusionRow, [string]>(
      `SELECT ${CONCLUSION_COLUMNS} FROM review_conclusions WHERE packet_id = ? ORDER BY created_at, rowid`,
    )
    .all(packetId)
    .map(toConclusion)
}

/** Claim the reviewer turn for a packet. Transactional and leased, so exactly one owner reviews it. */
export function claimReviewAttempt(
  db: BazilionDb,
  input: {
    packetId: string
    leaseOwner: string
    leaseMs: number
    now?: number
    supersedes?: string | null
  },
): { attempt: ReviewAttemptRecord; packet: ReviewPacketRecord } | null {
  const now = input.now ?? Date.now()
  return inTx(db, () => {
    const packet = getReviewPacket(db, input.packetId, now)
    if (!packet || packet.state !== 'open') return null
    const next =
      (db.raw
        .query<{ n: number }, [string]>(
          'SELECT COALESCE(MAX(attempt_number), 0) AS n FROM review_attempts WHERE packet_id = ?',
        )
        .get(input.packetId)?.n ?? 0) + 1
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO review_attempts (
         id, packet_id, attempt_number, supersedes_attempt_id, state, lease_owner, lease_expires_at, created_at
       ) VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?)`,
      [
        id,
        input.packetId,
        next,
        input.supersedes ?? null,
        input.leaseOwner,
        now + input.leaseMs,
        now,
      ],
    )
    setReviewPacketState(db, input.packetId, 'reviewing')
    const attempt = getReviewAttempt(db, id)
    if (!attempt)
      throw new ReviewPacketError('packet_not_found', 'the attempt could not be read back')
    return { attempt, packet }
  })
}

export function getReviewAttempt(db: BazilionDb, id: string): ReviewAttemptRecord | null {
  const row = db.raw
    .query<AttemptRow, [string]>(`SELECT ${ATTEMPT_COLUMNS} FROM review_attempts WHERE id = ?`)
    .get(id)
  return row ? toAttempt(row) : null
}

export function listReviewAttempts(db: BazilionDb, packetId: string): ReviewAttemptRecord[] {
  return db.raw
    .query<AttemptRow, [string]>(
      `SELECT ${ATTEMPT_COLUMNS} FROM review_attempts WHERE packet_id = ? ORDER BY attempt_number`,
    )
    .all(packetId)
    .map(toAttempt)
}

export function startReviewAttempt(
  db: BazilionDb,
  input: { attemptId: string; now?: number },
): boolean {
  const result = db.raw.run(
    `UPDATE review_attempts SET state = 'running', started_at = ?
     WHERE id = ? AND state = 'claimed' AND started_at IS NULL`,
    [input.now ?? Date.now(), input.attemptId],
  )
  return Number(result.changes) > 0
}

export function finishReviewAttempt(
  db: BazilionDb,
  input: {
    attemptId: string
    leaseOwner: string
    state: Exclude<ReviewAttemptRecord['state'], 'claimed' | 'running'>
    error?: string | null
    now?: number
  },
): boolean {
  if (input.error != null) assertLength(input.error, REVIEW_LIMITS.summary, 'error')
  const now = input.now ?? Date.now()
  return inTx(db, () => {
    const row = db.raw
      .query<AttemptRow, [string, string]>(
        `SELECT ${ATTEMPT_COLUMNS} FROM review_attempts WHERE id = ? AND lease_owner = ?`,
      )
      .get(input.attemptId, input.leaseOwner)
    if (!row) return false
    const attempt = toAttempt(row)
    if (attempt.finishedAt !== null) return false
    db.raw.run(
      `UPDATE review_attempts
       SET state = ?, finished_at = ?, lease_owner = NULL, lease_expires_at = NULL, error = ?
       WHERE id = ?`,
      [input.state, now, input.error ?? null, input.attemptId],
    )
    // `reviewed` only for a completed attempt; a failed or interrupted one leaves the packet open to an
    // explicit operator decision rather than reporting a review that did not happen.
    setReviewPacketState(db, attempt.packetId, input.state === 'completed' ? 'reviewed' : 'open')
    return true
  })
}

/**
 * Recover reviewer dispatch after a restart. An interrupted claim is `uncertain` and never replayed:
 * only an explicit new attempt may review the packet again.
 */
export function recoverInterruptedReviewAttempts(db: BazilionDb, staleBefore: number): number {
  return inTx(db, () => {
    const stale = db.raw
      .query<{ id: string; packet_id: string }, [number]>(
        `SELECT id, packet_id FROM review_attempts
         WHERE finished_at IS NULL AND lease_owner IS NOT NULL AND lease_expires_at <= ?`,
      )
      .all(staleBefore)
    for (const attempt of stale) {
      db.raw.run(
        `UPDATE review_attempts
         SET state = 'uncertain', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL,
             error = COALESCE(error, 'reviewer dispatch was interrupted')
         WHERE id = ?`,
        [staleBefore, attempt.id],
      )
      db.raw.run("UPDATE review_packets SET state = 'open' WHERE id = ? AND state = 'reviewing'", [
        attempt.packet_id,
      ])
    }
    return stale.length
  })
}

/** Retention: a packet past its window is removed with its findings, conclusions and attempts. */
export function pruneReviewPackets(db: BazilionDb, now = Date.now()): number {
  const result = db.raw.run('DELETE FROM review_packets WHERE expires_at <= ?', [now])
  return Number(result.changes)
}

const PACKET_COLUMNS =
  'id, team_id, requester_kind, requester_agent_id, reviewer_agent_id, snapshot_id, snapshot_complete, ' +
  'head, base_oid, summary, state, exported_at, export_revision, reported_json, created_at, expires_at'
const FINDING_COLUMNS =
  'id, packet_id, author_kind, author_agent_id, path, line_start, line_end, severity, note, snapshot_id, ' +
  'state, resolution_kind, resolution_note, resolved_at, resolved_by_kind, resolved_by_agent_id, created_at'
const CONCLUSION_COLUMNS =
  'id, packet_id, reviewer_kind, reviewer_agent_id, conclusion, note, snapshot_id, created_at'
const ATTEMPT_COLUMNS =
  'id, packet_id, attempt_number, supersedes_attempt_id, state, lease_owner, lease_expires_at, ' +
  'started_at, finished_at, error, created_at'

interface PacketRow {
  id: string
  team_id: string
  requester_kind: string
  requester_agent_id: string | null
  reviewer_agent_id: string | null
  snapshot_id: string
  snapshot_complete: number
  head: string | null
  base_oid: string
  summary: string | null
  state: string
  exported_at: number | null
  export_revision: string | null
  reported_json: string | null
  created_at: number
  expires_at: number
}

interface FindingRow {
  id: string
  packet_id: string
  author_kind: string
  author_agent_id: string | null
  path: string
  line_start: number | null
  line_end: number | null
  severity: string
  note: string
  snapshot_id: string
  state: string
  resolution_kind: string | null
  resolution_note: string | null
  resolved_at: number | null
  resolved_by_kind: string | null
  resolved_by_agent_id: string | null
  created_at: number
}

interface ConclusionRow {
  id: string
  packet_id: string
  reviewer_kind: string
  reviewer_agent_id: string | null
  conclusion: string
  note: string | null
  snapshot_id: string
  created_at: number
}

interface AttemptRow {
  id: string
  packet_id: string
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

function toPacket(row: PacketRow): ReviewPacketRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    requesterKind: row.requester_kind as 'agent' | 'operator',
    requesterAgentId: row.requester_agent_id,
    reviewerAgentId: row.reviewer_agent_id,
    snapshotId: row.snapshot_id,
    snapshotComplete: row.snapshot_complete === 1,
    head: row.head,
    baseOid: row.base_oid,
    summary: row.summary,
    state: row.state as ReviewPacketState,
    exportedAt: row.exported_at,
    exportRevision: row.export_revision,
    reported: parseReported(row.reported_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

/** A malformed report reads as unset rather than as a state nobody recorded. */
function parseReported(json: string | null): ReviewReportedStates {
  const empty: ReviewReportedStates = {
    committed: null,
    pushed: null,
    pullRequest: null,
    merged: null,
    deployed: null,
    productionAccepted: null,
  }
  if (!json) return empty
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    for (const state of REVIEW_REPORTED_STATES) {
      const value = parsed[state]
      if (typeof value === 'string' && value.trim() !== '') empty[state] = value
    }
    return empty
  } catch {
    return empty
  }
}

/**
 * Record one operator-reported external state.
 *
 * Reported, never verified: the operator supplies a reference (a commit id, a URL, a release name) and the
 * daemon stores it as what the operator said. There is no code-host integration here and none is claimed.
 */
export function recordReportedState(
  db: BazilionDb,
  input: { packetId: string; state: ReviewReportedState; reference: string | null },
): ReviewReportedStates {
  const packet = getReviewPacket(db, input.packetId)
  if (!packet) throw new ReviewPacketError('packet_not_found', 'the packet does not exist')
  if (!REVIEW_REPORTED_STATES.includes(input.state)) {
    throw new ReviewPacketError('invalid_resolution', `unknown reported state: ${input.state}`)
  }
  if (input.reference && input.reference.length > REVIEW_LIMITS.path) {
    throw new ReviewPacketError('invalid_resolution', 'the reported reference is too long')
  }
  const next = { ...packet.reported, [input.state]: input.reference?.trim() || null }
  db.raw.run('UPDATE review_packets SET reported_json = ? WHERE id = ?', [
    JSON.stringify(next),
    input.packetId,
  ])
  return next
}

function toFinding(row: FindingRow): ReviewFindingRow {
  return {
    id: row.id,
    packetId: row.packet_id,
    authorKind: row.author_kind as 'agent' | 'operator',
    authorAgentId: row.author_agent_id,
    path: row.path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    severity: row.severity as ReviewSeverity,
    note: row.note,
    snapshotId: row.snapshot_id,
    state: row.state as ReviewFindingState,
    resolutionKind: row.resolution_kind as ReviewResolutionKind | null,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    resolvedByKind: row.resolved_by_kind as 'agent' | 'operator' | null,
    resolvedByAgentId: row.resolved_by_agent_id,
    createdAt: row.created_at,
  }
}

function toConclusion(row: ConclusionRow): ReviewConclusionRow {
  return {
    id: row.id,
    packetId: row.packet_id,
    reviewerKind: row.reviewer_kind as 'agent' | 'operator',
    reviewerAgentId: row.reviewer_agent_id,
    conclusion: row.conclusion as ReviewConclusion,
    note: row.note,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
  }
}

function toAttempt(row: AttemptRow): ReviewAttemptRecord {
  return {
    id: row.id,
    packetId: row.packet_id,
    attemptNumber: row.attempt_number,
    supersedesAttemptId: row.supersedes_attempt_id,
    state: row.state as ReviewAttemptRecord['state'],
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    createdAt: row.created_at,
  }
}
