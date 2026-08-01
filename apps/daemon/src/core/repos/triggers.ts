import { randomUUID } from 'node:crypto'
import type { AgentTrigger, TriggerKind } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { cancelPendingForTrigger } from './triggerDispatches.ts'

interface RawTrigger {
  id: string
  agent_id: string
  kind: string
  interval_sec: number | null
  cron_expr: string | null
  message: string
  enabled: number
  last_fired_at: number | null
  created_at: number
}

function toTrigger(r: RawTrigger): AgentTrigger {
  return {
    id: r.id,
    agentId: r.agent_id,
    kind: r.kind as TriggerKind,
    intervalSec: r.interval_sec,
    cronExpr: r.cron_expr,
    message: r.message,
    enabled: r.enabled === 1,
    lastFiredAt: r.last_fired_at,
    createdAt: r.created_at,
  }
}

export interface InsertTriggerInput {
  agentId: string
  kind: TriggerKind
  intervalSec: number | null
  cronExpr: string | null
  message: string
  enabled?: boolean
}

export function insert(db: BazilionDb, input: InsertTriggerInput): AgentTrigger {
  const id = randomUUID()
  const now = Date.now()
  const enabled = input.enabled === false ? 0 : 1
  db.raw.run(
    `INSERT INTO agent_triggers
       (id, agent_id, kind, interval_sec, cron_expr, message, enabled, last_fired_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [id, input.agentId, input.kind, input.intervalSec, input.cronExpr, input.message, enabled, now],
  )
  return {
    id,
    agentId: input.agentId,
    kind: input.kind,
    intervalSec: input.intervalSec,
    cronExpr: input.cronExpr,
    message: input.message,
    enabled: enabled === 1,
    lastFiredAt: null,
    createdAt: now,
  }
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

export function listEnabled(db: BazilionDb): AgentTrigger[] {
  return db.raw
    .query<RawTrigger, []>(
      `SELECT t.* FROM agent_triggers t
         JOIN agents a ON a.id = t.agent_id
         WHERE t.enabled = 1
         ORDER BY t.created_at ASC`,
    )
    .all()
    .map(toTrigger)
}

export function setEnabled(db: BazilionDb, id: string, enabled: boolean): void {
  db.raw.transaction(() => {
    db.raw.run('UPDATE agent_triggers SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id])
    if (!enabled) cancelPendingForTrigger(db, id)
  })()
}

export function markFired(db: BazilionDb, id: string, when: number = Date.now()): void {
  db.raw.run('UPDATE agent_triggers SET last_fired_at = ? WHERE id = ?', [when, id])
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM agent_triggers WHERE id = ?', [id])
}
