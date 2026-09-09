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
