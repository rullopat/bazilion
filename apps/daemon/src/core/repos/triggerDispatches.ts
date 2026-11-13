// Run history of scheduled triggers: one row per occurrence, run at most once.
// pending → running → succeeded | failed | cancelled. A busy Agent leaves the
// occurrence pending; nothing is retried or replayed.

import { randomUUID } from 'node:crypto'
import type { TriggerDispatch, TriggerDispatchStatus } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

/** Error of a run cut short by a daemon stop. */
export const INTERRUPTED = 'interrupted: the daemon stopped during this run'

interface RawDispatch {
  id: string
  trigger_id: string
  agent_id: string
  conversation_id: string
  scheduled_at: number
  status: TriggerDispatchStatus
  started_at: number | null
  finished_at: number | null
  error: string | null
}

function toDispatch(row: RawDispatch): TriggerDispatch {
  return {
    id: row.id,
    triggerId: row.trigger_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  }
}

/** Record an occurrence; the same (trigger, scheduled time) is recorded once. */
export function materialize(
  db: BazilionDb,
  input: { triggerId: string; agentId: string; conversationId: string; scheduledAt: number },
): TriggerDispatch {
  db.raw.run(
    `INSERT INTO trigger_dispatches
       (id, trigger_id, agent_id, conversation_id, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(trigger_id, scheduled_at) DO NOTHING`,
    [randomUUID(), input.triggerId, input.agentId, input.conversationId, input.scheduledAt],
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

export function listPending(db: BazilionDb): TriggerDispatch[] {
  return db.raw
    .query<RawDispatch, []>(
      `SELECT * FROM trigger_dispatches WHERE status = 'pending' ORDER BY scheduled_at ASC`,
    )
    .all()
    .map(toDispatch)
}

/** Open occurrences make later ones of the same trigger coalesce. */
export function hasOpenForTrigger(db: BazilionDb, triggerId: string): boolean {
  return (
    db.raw
      .query<{ found: number }, [string]>(
        `SELECT 1 found FROM trigger_dispatches
         WHERE trigger_id = ? AND status IN ('pending','running') LIMIT 1`,
      )
      .get(triggerId) !== null
  )
}

/** pending → running. False when the occurrence is no longer pending. */
export function start(db: BazilionDb, id: string, now = Date.now()): boolean {
  return (
    db.raw.run(
      `UPDATE trigger_dispatches SET status = 'running', started_at = ?
       WHERE id = ? AND status = 'pending'`,
      [now, id],
    ).changes === 1
  )
}

/** Close an open occurrence. */
export function finish(
  db: BazilionDb,
  id: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  error: string | null = null,
  now = Date.now(),
): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = ?, finished_at = ?, error = ?
     WHERE id = ? AND status IN ('pending','running')`,
    [status, now, error?.slice(0, 2_000) ?? null, id],
  )
}

/** Boot sweep: a run still marked running was interrupted by a daemon stop. */
export function failInterrupted(db: BazilionDb, now = Date.now()): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'failed', finished_at = ?, error = ?
     WHERE status = 'running'`,
    [now, INTERRUPTED],
  )
}

export function cancelPendingForTrigger(db: BazilionDb, triggerId: string, now = Date.now()): void {
  db.raw.run(
    `UPDATE trigger_dispatches SET status = 'cancelled', finished_at = ?
     WHERE trigger_id = ? AND status = 'pending'`,
    [now, triggerId],
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
