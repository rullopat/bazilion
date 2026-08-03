import { randomUUID } from 'node:crypto'
import type { AgentReview, AgentReviewStatus, AgentReviewTrigger } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawReview {
  id: string
  agent_id: string
  status: string
  trigger_kind: string
  source_session_id: string | null
  source_start_ordinal: number | null
  source_end_ordinal: number | null
  input_characters: number
  turns_reviewed: number
  proposal_count: number
  attempt_count: number
  next_attempt_at: number
  lease_expires_at: number | null
  started_at: number | null
  finished_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

function toReview(row: RawReview): AgentReview {
  return {
    id: row.id,
    agentId: row.agent_id,
    status: row.status as AgentReviewStatus,
    trigger: row.trigger_kind as AgentReviewTrigger,
    sourceSessionId: row.source_session_id,
    sourceStartOrdinal: row.source_start_ordinal,
    sourceEndOrdinal: row.source_end_ordinal,
    inputCharacters: row.input_characters,
    turnsReviewed: row.turns_reviewed,
    proposalCount: row.proposal_count,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function insert(
  db: BazilionDb,
  agentId: string,
  trigger: AgentReviewTrigger,
  now: number,
): AgentReview {
  const id = randomUUID()
  db.raw.run(
    `INSERT INTO agent_reviews
       (id, agent_id, status, trigger_kind, input_characters, turns_reviewed,
        proposal_count, attempt_count, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, 0, 0, 0, 0, ?, ?, ?)`,
    [id, agentId, trigger, now, now, now],
  )
  const review = get(db, id)
  if (!review) throw new Error('agent review enqueue failed')
  return review
}

export function get(db: BazilionDb, id: string): AgentReview | null {
  const row = db.raw.query<RawReview, [string]>('SELECT * FROM agent_reviews WHERE id = ?').get(id)
  return row ? toReview(row) : null
}

export function getOpenForAgent(db: BazilionDb, agentId: string): AgentReview | null {
  const row = db.raw
    .query<RawReview, [string]>(
      `SELECT * FROM agent_reviews WHERE agent_id = ?
       AND status IN ('pending','running','retrying') LIMIT 1`,
    )
    .get(agentId)
  return row ? toReview(row) : null
}

export function enqueueManual(db: BazilionDb, agentId: string, now = Date.now()): AgentReview {
  return db.raw.transaction(
    () => getOpenForAgent(db, agentId) ?? insert(db, agentId, 'manual', now),
  )()
}

/** Count one successful interactive turn and atomically enqueue when cadence becomes due. */
export function recordSuccessfulUserTurn(
  db: BazilionDb,
  agentId: string,
  now = Date.now(),
): AgentReview | null {
  return db.raw.transaction(() => {
    const updated = db.raw.run(
      `UPDATE agents SET review_turns_since_last = review_turns_since_last + 1
       WHERE id = ? AND review_enabled = 1`,
      [agentId],
    )
    if (Number(updated.changes) !== 1) return null
    const state = db.raw
      .query<{ review_turns_since_last: number; review_every_n_turns: number }, [string]>(
        `SELECT review_turns_since_last, review_every_n_turns FROM agents WHERE id = ?`,
      )
      .get(agentId)
    if (!state || state.review_turns_since_last < state.review_every_n_turns) return null
    const open = getOpenForAgent(db, agentId)
    if (open) return open
    const review = insert(db, agentId, 'cadence', now)
    db.raw.run('UPDATE agents SET review_turns_since_last = 0 WHERE id = ?', [agentId])
    return review
  })()
}

export function listClaimable(db: BazilionDb, now = Date.now()): AgentReview[] {
  return db.raw
    .query<RawReview, [number, number]>(
      `SELECT * FROM agent_reviews
       WHERE (status IN ('pending','retrying') AND next_attempt_at <= ?)
          OR (status = 'running' AND lease_expires_at <= ?)
       ORDER BY created_at ASC`,
    )
    .all(now, now)
    .map(toReview)
}

export function claim(
  db: BazilionDb,
  id: string,
  options: { now?: number; leaseMs?: number } = {},
): AgentReview | null {
  const now = options.now ?? Date.now()
  const leaseExpiresAt = now + (options.leaseMs ?? 5 * 60_000)
  return db.raw.transaction(() => {
    const result = db.raw.run(
      `UPDATE agent_reviews SET status = 'running', attempt_count = attempt_count + 1,
       lease_expires_at = ?, started_at = ?, finished_at = NULL, updated_at = ?
       WHERE id = ? AND (
         (status IN ('pending','retrying') AND next_attempt_at <= ?)
         OR (status = 'running' AND lease_expires_at <= ?)
       )`,
      [leaseExpiresAt, now, now, id, now, now],
    )
    return Number(result.changes) === 1 ? get(db, id) : null
  })()
}

export function setSource(
  db: BazilionDb,
  id: string,
  source: {
    sessionId: string
    startOrdinal: number
    endOrdinal: number
    inputCharacters: number
    turnsReviewed: number
  },
): void {
  db.raw.run(
    `UPDATE agent_reviews SET source_session_id = ?, source_start_ordinal = ?,
     source_end_ordinal = ?, input_characters = ?, turns_reviewed = ?, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [
      source.sessionId,
      source.startOrdinal,
      source.endOrdinal,
      source.inputCharacters,
      source.turnsReviewed,
      Date.now(),
      id,
    ],
  )
}

export function complete(
  db: BazilionDb,
  id: string,
  proposalCount: number,
  now = Date.now(),
): void {
  db.raw.run(
    `UPDATE agent_reviews SET status = 'completed', proposal_count = ?, lease_expires_at = NULL,
     finished_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'running'`,
    [proposalCount, now, now, id],
  )
}

export function cancel(db: BazilionDb, id: string, reason: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE agent_reviews SET status = 'cancelled', lease_expires_at = NULL, finished_at = ?,
     last_error = ?, updated_at = ? WHERE id = ? AND status IN ('pending','running','retrying')`,
    [now, reason.slice(0, 2_000), now, id],
  )
}

export function fail(
  db: BazilionDb,
  id: string,
  error: string,
  options: { now?: number; maxAttempts?: number; retryDelayMs?: number } = {},
): void {
  const now = options.now ?? Date.now()
  const current = get(db, id)
  if (current?.status !== 'running') return
  const terminal = current.attemptCount >= (options.maxAttempts ?? 3)
  const retryDelay = (options.retryDelayMs ?? 5_000) * 2 ** Math.max(0, current.attemptCount - 1)
  db.raw.run(
    `UPDATE agent_reviews SET status = ?, next_attempt_at = ?, lease_expires_at = NULL,
     finished_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'`,
    [
      terminal ? 'failed' : 'retrying',
      terminal ? now : now + retryDelay,
      terminal ? now : null,
      error.slice(0, 2_000),
      now,
      id,
    ],
  )
}

export function listForAgent(db: BazilionDb, agentId: string, limit = 50): AgentReview[] {
  return db.raw
    .query<RawReview, [string, number]>(
      'SELECT * FROM agent_reviews WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(agentId, limit)
    .map(toReview)
}
