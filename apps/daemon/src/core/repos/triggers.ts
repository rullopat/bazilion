import { randomUUID } from 'node:crypto'
import type { AgentTrigger, TriggerKind, TriggerSetBy, TriggerTiming } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { cancelPendingForTrigger } from './triggerDispatches.ts'

interface RawTrigger {
  id: string
  agent_id: string
  kind: string
  interval_sec: number | null
  cron_expr: string | null
  run_at: number | null
  message: string
  enabled: number
  last_fired_at: number | null
  created_at: number
  conversation_id: string | null
  set_by: string
}

function toTrigger(r: RawTrigger): AgentTrigger {
  return {
    id: r.id,
    agentId: r.agent_id,
    kind: r.kind as TriggerKind,
    intervalSec: r.interval_sec,
    cronExpr: r.cron_expr,
    runAt: r.run_at,
    message: r.message,
    enabled: r.enabled === 1,
    lastFiredAt: r.last_fired_at,
    createdAt: r.created_at,
    conversationId: r.conversation_id,
    setBy: r.set_by as TriggerSetBy,
  }
}

/** The timing columns: only the one its kind uses is set. */
function timingColumns(
  timing: TriggerTiming,
): [string, number | null, string | null, number | null] {
  return [
    timing.kind,
    timing.kind === 'interval' ? timing.intervalSec : null,
    timing.kind === 'cron' ? timing.cronExpr : null,
    timing.kind === 'once' ? timing.runAt : null,
  ]
}

export type InsertTriggerInput = {
  agentId: string
  message: string
  enabled?: boolean
  /** The conversation it runs in; the Agent's selected one when omitted. */
  conversationId?: string | null
  setBy?: TriggerSetBy
} & TriggerTiming

export function insert(db: BazilionDb, input: InsertTriggerInput): AgentTrigger {
  const id = randomUUID()
  db.raw.run(
    `INSERT INTO agent_triggers
       (id, agent_id, kind, interval_sec, cron_expr, run_at, message, enabled, last_fired_at,
        created_at, conversation_id, set_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      input.agentId,
      ...timingColumns(input),
      input.message,
      input.enabled === false ? 0 : 1,
      Date.now(),
      input.conversationId ?? null,
      input.setBy ?? 'owner',
    ],
  )
  return get(db, id) as AgentTrigger
}

export function get(db: BazilionDb, id: string): AgentTrigger | null {
  const row = db.raw
    .query<RawTrigger, [string]>('SELECT * FROM agent_triggers WHERE id = ?')
    .get(id)
  return row ? toTrigger(row) : null
}

export function listForAgent(db: BazilionDb, agentId: string): AgentTrigger[] {
  return db.raw
    .query<RawTrigger, [string]>(
      'SELECT * FROM agent_triggers WHERE agent_id = ? ORDER BY created_at ASC',
    )
    .all(agentId)
    .map(toTrigger)
}

/** Enabled triggers of non-archived Agents: the ones the scheduler may fire. */
export function listEnabled(db: BazilionDb): AgentTrigger[] {
  return db.raw
    .query<RawTrigger, []>(
      `SELECT t.* FROM agent_triggers t
         JOIN agents a ON a.id = t.agent_id
         WHERE t.enabled = 1 AND a.status != 'archived'
         ORDER BY t.created_at ASC`,
    )
    .all()
    .map(toTrigger)
}

export function setEnabled(db: BazilionDb, id: string, enabled: boolean): void {
  db.raw.transaction(() => {
    db.raw.run('UPDATE agent_triggers SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
    if (!enabled) {
      cancelPendingForTrigger(db, id)
      // A one-time schedule whose run was still waiting has not run: it is due again once on.
      db.raw.run(
        `UPDATE agent_triggers SET last_fired_at = NULL
         WHERE id = ? AND kind = 'once' AND NOT EXISTS (
           SELECT 1 FROM trigger_dispatches d
           WHERE d.trigger_id = agent_triggers.id AND d.scheduled_at = agent_triggers.run_at
             AND d.status IN ('running', 'succeeded', 'failed'))`,
        [id],
      )
    }
  })()
}

export function setMessage(db: BazilionDb, id: string, message: string): void {
  db.raw.run('UPDATE agent_triggers SET message = ? WHERE id = ?', [message, id])
}

/**
 * A new timing. A run still waiting for the Agent is dropped; an interval keeps counting from its
 * last run, and a one-time schedule moved past its run is due again (see `onceDone`).
 */
export function setTiming(db: BazilionDb, id: string, timing: TriggerTiming): void {
  db.raw.transaction(() => {
    db.raw.run(
      'UPDATE agent_triggers SET kind = ?, interval_sec = ?, cron_expr = ?, run_at = ? WHERE id = ?',
      [...timingColumns(timing), id],
    )
    cancelPendingForTrigger(db, id)
  })()
}

/** A one-time schedule has run: its last run is at or after its time. */
export function onceDone(t: AgentTrigger): boolean {
  return t.kind === 'once' && t.lastFiredAt !== null && t.runAt !== null && t.lastFiredAt >= t.runAt
}

export function markFired(db: BazilionDb, id: string, when: number = Date.now()): void {
  db.raw.run('UPDATE agent_triggers SET last_fired_at = ? WHERE id = ?', [when, id])
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM agent_triggers WHERE id = ?', [id])
}
