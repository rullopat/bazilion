// Per-agent-topic Telegram override repo (migration 0008). A missing row means
// "no overrides" (all defaults). `allow_from` is stored as a JSON int array.

import type { AgentTelegramOverride } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawOverride {
  agent_id: string
  require_mention: number
  allow_from: string | null
  silent: number
  updated_at: number | null
}

function parseAllowFrom(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return []
  }
}

function toOverride(r: RawOverride): AgentTelegramOverride {
  return {
    agentId: r.agent_id,
    requireMention: r.require_mention === 1,
    allowFrom: parseAllowFrom(r.allow_from),
    silent: r.silent === 1,
    updatedAt: r.updated_at,
  }
}

export function get(db: BazilionDb, agentId: string): AgentTelegramOverride | null {
  const row = db.raw
    .query<RawOverride, [string]>('SELECT * FROM agent_telegram_overrides WHERE agent_id = ?')
    .get(agentId)
  return row ? toOverride(row) : null
}

export interface OverridePatch {
  requireMention?: boolean
  allowFrom?: number[]
  silent?: boolean
}

/** Upsert: merges the patch onto the existing row (or defaults). */
export function set(db: BazilionDb, agentId: string, patch: OverridePatch): AgentTelegramOverride {
  const current = get(db, agentId)
  const requireMention = patch.requireMention ?? current?.requireMention ?? false
  const allowFrom = patch.allowFrom ?? current?.allowFrom ?? []
  const silent = patch.silent ?? current?.silent ?? false
  db.raw.run(
    `INSERT INTO agent_telegram_overrides (agent_id, require_mention, allow_from, silent, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       require_mention = excluded.require_mention,
       allow_from = excluded.allow_from,
       silent = excluded.silent,
       updated_at = excluded.updated_at`,
    [agentId, requireMention ? 1 : 0, JSON.stringify(allowFrom), silent ? 1 : 0, Date.now()],
  )
  return get(db, agentId) as AgentTelegramOverride
}

export function remove(db: BazilionDb, agentId: string): void {
  db.raw.run('DELETE FROM agent_telegram_overrides WHERE agent_id = ?', [agentId])
}
