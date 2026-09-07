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
