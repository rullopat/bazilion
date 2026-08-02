import { randomUUID } from 'node:crypto'
import type { TriggerDispatch, TriggerDispatchStatus } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawDispatch {
  id: string
  trigger_id: string
  agent_id: string
  scheduled_at: number
  status: string
  attempt_count: number
  next_attempt_at: number
  lease_expires_at: number | null
  started_at: number | null
  finished_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

function toDispatch(row: RawDispatch): TriggerDispatch {
  return {
    id: row.id,
    triggerId: row.trigger_id,
    agentId: row.agent_id,
    scheduledAt: row.scheduled_at,
    status: row.status as TriggerDispatchStatus,
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

export function materialize(
  db: BazilionDb,
  input: { triggerId: string; agentId: string; scheduledAt: number; now?: number },
): TriggerDispatch {
  const now = input.now ?? Date.now()
  db.raw.run(
    `INSERT INTO trigger_dispatches
       (id, trigger_id, agent_id, scheduled_at, status, attempt_count, next_attempt_at,
        lease_expires_at, started_at, finished_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(trigger_id, scheduled_at) DO NOTHING`,
    [randomUUID(), input.triggerId, input.agentId, input.scheduledAt, now, now, now],
  )
  const row = db.raw
    .query<RawDispatch, [string, number]>(
      'SELECT * FROM trigger_dispatches WHERE trigger_id = ? AND scheduled_at = ?',
    )
    .get(input.triggerId, input.scheduledAt)
  if (!row) throw new Error('trigger dispatch materialization failed')
  return toDispatch(row)
}

export function get(db: BazilionDb, id: string): TriggerDispatch | null {
  const row = db.raw
    .query<RawDispatch, [string]>('SELECT * FROM trigger_dispatches WHERE id = ?')
    .get(id)
  return row ? toDispatch(row) : null
}

export function listClaimable(db: BazilionDb, now = Date.now()): TriggerDispatch[] {
  return db.raw
    .query<RawDispatch, [number, number]>(
      `SELECT * FROM trigger_dispatches
       WHERE (status IN ('pending','retrying') AND next_attempt_at <= ?)
          OR (status = 'running' AND lease_expires_at <= ?)
       ORDER BY scheduled_at ASC, created_at ASC`,
    )
    .all(now, now)
    .map(toDispatch)
}

export function hasOpenForTrigger(db: BazilionDb, triggerId: string): boolean {
  return (
    db.raw
      .query<{ found: number }, [string]>(
        `SELECT 1 found FROM trigger_dispatches
         WHERE trigger_id = ? AND status IN ('pending','running','retrying') LIMIT 1`,
      )
      .get(triggerId) !== null
  )
}

export function claim(
  db: BazilionDb,
  id: string,
  options: { now?: number; leaseMs?: number } = {},
): TriggerDispatch | null {
  const now = options.now ?? Date.now()
  const leaseExpiresAt = now + (options.leaseMs ?? 5 * 60_000)
  return db.raw.transaction(() => {
    const result = db.raw.run(
      `UPDATE trigger_dispatches
       SET status = 'running', attempt_count = attempt_count + 1,
           lease_expires_at = ?, started_at = ?, finished_at = NULL, updated_at = ?
       WHERE id = ? AND (
         (status IN ('pending','retrying') AND next_attempt_at <= ?)
         OR (status = 'running' AND lease_expires_at <= ?)
       )`,
      [leaseExpiresAt, now, now, id, now, now],
    )
    if (Number(result.changes) !== 1) return null
    const row = db.raw
      .query<RawDispatch, [string]>('SELECT * FROM trigger_dispatches WHERE id = ?')
      .get(id)
    return row ? toDispatch(row) : null
  })()
}

export function succeed(db: BazilionDb, id: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'succeeded', lease_expires_at = NULL,
     finished_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'running'`,
    [now, now, id],
  )
}

export function defer(db: BazilionDb, id: string, nextAttemptAt = Date.now() + 1_000): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'pending',
     attempt_count = CASE WHEN attempt_count > 0 THEN attempt_count - 1 ELSE 0 END,
     next_attempt_at = ?, lease_expires_at = NULL, started_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [nextAttemptAt, Date.now(), id],
  )
}

export function cancelRunning(db: BazilionDb, id: string, reason: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'cancelled', lease_expires_at = NULL,
     finished_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'`,
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
  const maxAttempts = options.maxAttempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 5_000
  const current = db.raw
    .query<{ attempt_count: number }, [string]>(
      'SELECT attempt_count FROM trigger_dispatches WHERE id = ?',
    )
    .get(id)
  if (!current) return
  const terminal = current.attempt_count >= maxAttempts
  db.raw.run(
    `UPDATE trigger_dispatches SET status = ?, next_attempt_at = ?, lease_expires_at = NULL,
     finished_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'`,
    [
      terminal ? 'failed' : 'retrying',
      terminal ? now : now + retryDelayMs * 2 ** Math.max(0, current.attempt_count - 1),
      terminal ? now : null,
      error.slice(0, 2_000),
      now,
      id,
    ],
  )
}

export function cancelPendingForTrigger(db: BazilionDb, triggerId: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'cancelled', finished_at = ?, updated_at = ?
     WHERE trigger_id = ? AND status IN ('pending','retrying')`,
    [now, now, triggerId],
  )
}

export function listForTrigger(db: BazilionDb, triggerId: string, limit = 20): TriggerDispatch[] {
  return db.raw
    .query<RawDispatch, [string, number]>(
      'SELECT * FROM trigger_dispatches WHERE trigger_id = ? ORDER BY scheduled_at DESC LIMIT ?',
    )
    .all(triggerId, limit)
    .map(toDispatch)
}
