import type { BazilionDb } from '../core/db/client.ts'
import { expirePending, finishDelivery } from '../core/repos/communicationApprovals.ts'
import { isActiveAgent } from './agent-cancel.ts'

// The three canonical held file payloads contain only an opaque receipt reference.
const referenceSql = `CASE payload_kind
  WHEN 'agent_result' THEN json_extract(payload_json, '$.resultId')
  WHEN 'http_chat_frame' THEN json_extract(payload_json, '$.frame.event.result.resultId')
  WHEN 'telegram_file' THEN json_extract(payload_json, '$.result.resultId') END`

/** Startup only: an interrupted transport cannot truthfully be marked delivered or retried. */
export function recoverInterruptedResultDeliveries(db: BazilionDb): void {
  const interrupted = db.raw
    .query<{ id: string }, []>(
      `SELECT id FROM communication_approvals WHERE status = 'delivering'
      AND (${referenceSql}) IS NOT NULL`,
    )
    .all()
  for (const { id } of interrupted) {
    finishDelivery(db, id, false, 'system', 'Result delivery interrupted by daemon restart')
  }
}

/** Reclaim private bytes after their producer and every held delivery have settled. */
export function reconcilePrivateResults(
  db: BazilionDb,
  options: { excludeAgentId?: string } = {},
): number {
  expirePending(db)
  const candidates = db.raw
    .query<{ id: string; agentId: string }, []>(
      `SELECT id, agent_id AS agentId FROM agent_results r
     WHERE released_at IS NULL AND deleted_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM communication_approvals
       WHERE status IN ('pending', 'delivering') AND (${referenceSql}) = r.id
     )`,
    )
    .all()
  let reclaimed = 0
  for (const result of candidates) {
    if (result.agentId === options.excludeAgentId || isActiveAgent(result.agentId)) continue
    reclaimed += db.raw.run(
      `UPDATE agent_results SET bytes = NULL, deleted_at = ?
       WHERE id = ? AND released_at IS NULL AND deleted_at IS NULL`,
      [Date.now(), result.id],
    ).changes
  }
  return reclaimed
}
