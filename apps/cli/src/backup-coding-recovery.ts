import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Called within the staged restore transaction after schema/path validation. Never runs cleanup. */
export function invalidateRestoredCodingEvidence(
  db: DatabaseSync,
  payload: string,
  targetHome: string,
): void {
  const rows = db.prepare('SELECT id, receipt_json FROM coding_commands').all() as Array<{
    id: string
    receipt_json: string
  }>
  for (const row of rows) {
    const receipt = JSON.parse(row.receipt_json)
    receipt.environment.inputFingerprint = null
    if (!receipt.finishedAt) {
      receipt.state = 'interrupted'
      receipt.reason = 'backup_restored'
      receipt.finishedAt = Date.now()
    }
    db.prepare('UPDATE coding_commands SET state = ?, receipt_json = ? WHERE id = ?').run(
      receipt.state,
      JSON.stringify(receipt),
      row.id,
    )
  }
  // Retained BAZ-041 logs keep their original expiry across the backup round-trip. A
  // restored copy must not serve bytes whose retention window has already passed.
  const restoredAt = Date.now()
  db.prepare(
    `UPDATE coding_command_logs SET state = 'expired', text = NULL, byte_length = 0, retired_at = ?
     WHERE state = 'retained' AND expires_at <= ?`,
  ).run(restoredAt, restoredAt)
  // BAZ-042 source snapshots keep their original window across the round-trip and have no
  // tombstone: a manifest past its window is simply absent, which reads as unknown applicability
  // rather than as evidence. Snapshots inside the window are preserved as captured.
  db.prepare('DELETE FROM source_snapshots WHERE expires_at <= ?').run(restoredAt)
  // BAZ-044 verification requests keep their original window. A request past it is simply gone,
  // and one whose captured evidence did not survive the round-trip cannot be executed: it becomes
  // blocked rather than silently running against an unknown tree.
  db.prepare('DELETE FROM verification_requests WHERE expires_at <= ?').run(restoredAt)
  db.prepare(
    `UPDATE verification_requests SET state = 'blocked'
     WHERE state IN ('pending', 'awaiting_approval')
       AND NOT EXISTS (SELECT 1 FROM source_snapshots snapshot
                       WHERE snapshot.snapshot_id = verification_requests.snapshot_id
                         AND snapshot.team_id = verification_requests.team_id
                         AND snapshot.expires_at > ?)`,
  ).run(restoredAt)
  // An execution that was still open did not report an outcome, so it is uncertain and is never
  // replayed. A receipt-backed outcome does not survive either: the restore invalidated the
  // receipts above, so the outcome reads unknown instead of presenting another home's evidence.
  db.prepare(
    `UPDATE verification_attempts
     SET state = 'uncertain', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL,
         error = 'execution was interrupted by a backup restore'
     WHERE finished_at IS NULL`,
  ).run(restoredAt)
  // Collect the requests that relied on a receipt before rewriting those outcomes.
  const invalidated = db
    .prepare(
      `SELECT DISTINCT attempt.request_id AS request_id
       FROM verification_check_outcomes outcome
       JOIN verification_attempts attempt ON attempt.id = outcome.attempt_id
       WHERE outcome.state IN ('succeeded', 'failed', 'timed_out', 'cancelled')`,
    )
    .all() as Array<{ request_id: string }>
  db.prepare(
    `UPDATE verification_check_outcomes
     SET state = 'unknown', command_id = NULL, exit_code = NULL, finished_at = ?
     WHERE state IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'not_executed')`,
  ).run(restoredAt)
  const reopen = db.prepare(`UPDATE verification_requests SET state = 'uncertain' WHERE id = ?`)
  const invalidateAttempt = db.prepare(
    `UPDATE verification_attempts
     SET state = 'uncertain', error = 'evidence was invalidated by a backup restore'
     WHERE request_id = ? AND state IN ('completed', 'failed')`,
  )
  for (const row of invalidated) {
    invalidateAttempt.run(row.request_id)
    reopen.run(row.request_id)
  }
  // A copied registration can miss resources launched later in the original daemon. Never infer
  // safety from an empty copied resource list or kill a process belonging to another live home.
  db.prepare("UPDATE workspace_writers SET state = 'recovery', recovery_mode = 'restored'").run()
  const teams = db.prepare('SELECT id FROM teams').all() as Array<{ id: string }>
  const rebase = db.prepare('UPDATE workspace_writers SET root_path = ? WHERE team_id = ?')
  for (const team of teams) {
    // Team IDs and staged slots were validated by the caller. Do not follow external symlinks.
    if (lstatSync(resolve(payload, 'teams', team.id)).isDirectory())
      rebase.run(resolve(targetHome, 'teams', team.id), team.id)
  }
}
