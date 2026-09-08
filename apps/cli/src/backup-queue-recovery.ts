import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** Offline staged-home mutation. A backup cannot prove which later side effects happened. */
export function pauseRestoredUserQueue(database: string): void {
  const db = new DatabaseSync(database)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = DELETE')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('BEGIN IMMEDIATE')
    try {
      const unresolved = "status IN ('pending','claimed','running','held','uncertain')"
      db.exec(`INSERT OR IGNORE INTO user_queue_controls (agent_id)
        SELECT DISTINCT agent_id FROM user_queue_items WHERE ${unresolved}`)
      db.exec(`UPDATE user_queue_controls SET paused = 1, revision = revision + 1,
        reason = 'restored_backup' WHERE agent_id IN
        (SELECT agent_id FROM user_queue_items WHERE ${unresolved})`)
      const now = Date.now()
      // Telegram may retain sends newer than this snapshot. Restore always needs an
      // explicit fresh cutoff, including when this snapshot had no settings row yet.
      db.prepare(`INSERT INTO notification_settings
        (singleton, restore_paused, restore_history_uncertain, kinds_json, updated_at) VALUES (1, 1, 1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET enabled=0, restore_paused=1, restore_history_uncertain=1,
          revision=revision+1, updated_at=MAX(updated_at+1, excluded.updated_at)`).run(
        JSON.stringify([
          'communication_approval',
          'lesson_proposal',
          'review_failure',
          'trigger_failure',
          'agent_loop_break',
        ]),
        now,
      )
      db.prepare(`UPDATE notification_receipts SET state='uncertain', diagnostic='restored_backup',
        updated_at=MAX(updated_at+1, ?) WHERE state='sending'`).run(now)
      db.prepare(`UPDATE notification_receipts SET state='suppressed', diagnostic='restore_paused',
        updated_at=MAX(updated_at+1, ?) WHERE state='deferred'`).run(now)
      db.prepare(`UPDATE agent_questions SET status = 'cancelled', no_answer_reason = 'restored_backup',
        settled_at = ?, continuation = 'interrupted', revision = revision + 1 WHERE status = 'pending'`).run(
        now,
      )
      db.exec(`UPDATE agent_questions SET continuation = 'interrupted', revision = revision + 1
        WHERE continuation = 'unconfirmed'`)
      // Offline restore cannot import daemon runtime. Mirror the canonical cancellation
      // and audit event only for pending approvals owned by closed question records.
      const questionApprovals = db
        .prepare(`SELECT DISTINCT a.id FROM communication_approvals a
        JOIN agent_questions q ON a.id IN (q.delivery_approval_id, q.answer_approval_id)
        WHERE q.status != 'pending' AND a.status = 'pending'
          AND a.payload_kind IN ('question_delivery', 'question_answer')`)
        .all() as Array<{ id: string }>
      for (const approval of questionApprovals) {
        db.prepare(`UPDATE communication_approvals SET status = 'cancelled', decided_at = ?,
          decided_by = 'system', decision_reason = 'Restored question has no live continuation',
          updated_at = ? WHERE id = ? AND status = 'pending'`).run(now, now, approval.id)
        db.prepare(`INSERT INTO communication_approval_events (id, approval_id, event, actor, detail, created_at)
          VALUES (?, ?, 'cancelled', 'system', 'Restored question has no live continuation', ?)`).run(
          randomUUID(),
          approval.id,
          now,
        )
      }
      db.prepare(`UPDATE user_queue_items SET status = 'uncertain', revision = revision + 1,
        diagnostic = 'Restored backup: this input may already have acted; reconcile before resuming',
        updated_at = ?, finished_at = ? WHERE ${unresolved}`).run(now, now)
      // Canonical approval references remain intact. Their dispatcher requires a held
      // queue head; uncertainty makes both pending and interrupted approvals non-executable.
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    db.close()
  }
}
