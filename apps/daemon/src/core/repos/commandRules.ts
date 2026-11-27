import { randomUUID } from 'node:crypto'
import type { CommandRule } from '@bazilion/api-types'
import { ruleAllows } from '../command-rules.ts'
import type { BazilionDb } from '../db/client.ts'

interface RawRule {
  id: string
  agent_id: string
  prefix: string
  created_at: number
}

const toRule = (r: RawRule): CommandRule => ({
  id: r.id,
  agentId: r.agent_id,
  prefix: r.prefix,
  createdAt: r.created_at,
})

/** Every rule, or one Agent's, oldest first. */
export function list(db: BazilionDb, agentId?: string): CommandRule[] {
  const rows = agentId
    ? db.raw
        .query<RawRule, [string]>(
          'SELECT * FROM command_rules WHERE agent_id = ? ORDER BY created_at, rowid',
        )
        .all(agentId)
    : db.raw.query<RawRule, []>('SELECT * FROM command_rules ORDER BY created_at, rowid').all()
  return rows.map(toRule)
}

/** Add a rule; the same prefix twice is one rule. */
export function add(db: BazilionDb, agentId: string, prefix: string): CommandRule {
  db.raw.run(
    'INSERT INTO command_rules (id, agent_id, prefix, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, prefix) DO NOTHING',
    [randomUUID(), agentId, prefix, Date.now()],
  )
  const row = db.raw
    .query<RawRule, [string, string]>(
      'SELECT * FROM command_rules WHERE agent_id = ? AND prefix = ?',
    )
    .get(agentId, prefix)
  if (!row) throw new Error('the rule was not saved')
  return toRule(row)
}

export function remove(db: BazilionDb, id: string): boolean {
  return db.raw.run('DELETE FROM command_rules WHERE id = ?', [id]).changes > 0
}

/** The Agent's rule that allows this command, if any. */
export function matching(db: BazilionDb, agentId: string, command: string): CommandRule | null {
  return list(db, agentId).find((rule) => ruleAllows(rule.prefix, command)) ?? null
}
