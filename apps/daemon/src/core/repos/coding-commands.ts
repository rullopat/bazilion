import type { CodingCommandReceipt } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

/** Matches the retained-diagnostic window so a log cannot outlive its receipt. */
export const CODING_COMMAND_TTL_MS = 7 * 86400000
/**
 * Safety valve, not the governing limit. The seven-day clock is what actually bounds
 * retention; this only stops one very busy Team from growing receipt bytes without
 * bound. BAZ-041 widened this from 20 so a coding session's earlier commands keep
 * their diagnostics for the documented window instead of minutes.
 */
export const CODING_COMMAND_MAX_PER_TEAM = 200

export function pruneCodingCommands(db: BazilionDb, teamId: string) {
  db.raw.run(
    "DELETE FROM coding_commands WHERE team_id = ? AND state != 'running' AND created_at < ?",
    [teamId, Date.now() - CODING_COMMAND_TTL_MS],
  )
  db.raw.run(
    "DELETE FROM coding_commands WHERE id IN (SELECT id FROM coding_commands WHERE team_id = ? AND state != 'running' ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)",
    [teamId, CODING_COMMAND_MAX_PER_TEAM],
  )
}
export function saveCodingCommand(db: BazilionDb, receipt: CodingCommandReceipt) {
  db.raw.run(
    `INSERT INTO coding_commands (id, team_id, agent_id, turn_id, tool_call_id, state, created_at, receipt_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, receipt_json = excluded.receipt_json`,
    [
      receipt.id,
      receipt.teamId,
      receipt.agentId,
      receipt.turnId,
      receipt.toolCallId,
      receipt.state,
      receipt.startedAt,
      JSON.stringify(receipt),
    ],
  )
  pruneCodingCommands(db, receipt.teamId)
}
export function getCodingCommand(db: BazilionDb, id: string): CodingCommandReceipt | null {
  const row = db.raw
    .query<{ receipt_json: string }, [string]>(
      'SELECT receipt_json FROM coding_commands WHERE id = ?',
    )
    .get(id)
  return row ? JSON.parse(row.receipt_json) : null
}
/** Never replay an operation that outlived its owning turn or daemon. */
export function interruptCodingCommands(db: BazilionDb, turnId?: string) {
  const rows = db.raw
    .query<{ receipt_json: string }, []>('SELECT receipt_json FROM coding_commands')
    .all()
  for (const row of rows) {
    const receipt = JSON.parse(row.receipt_json) as CodingCommandReceipt
    if (turnId && receipt.turnId !== turnId) continue
    if (!turnId) receipt.environment.inputFingerprint = null
    if (receipt.state === 'running') {
      receipt.state = 'interrupted'
      receipt.reason = 'turn_ended_without_terminal_result'
      receipt.finishedAt = Date.now()
    }
    db.raw.run('UPDATE coding_commands SET state = ?, receipt_json = ? WHERE id = ?', [
      receipt.state,
      JSON.stringify(receipt),
      receipt.id,
    ])
  }
  for (const team of db.raw
    .query<{ team_id: string }, []>('SELECT DISTINCT team_id FROM coding_commands')
    .all())
    pruneCodingCommands(db, team.team_id)
}
