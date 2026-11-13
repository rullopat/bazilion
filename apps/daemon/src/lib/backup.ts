import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { create } from 'tar'
import type { BazilionDb, Paths } from '../core/index.ts'
import { DAEMON_PID_FILE } from './daemon-liveness.ts'

export interface BackupSnapshot {
  directory: string
  database: string
  cleanup(): void
}

// One online backup per source connection at a time: queue only the snapshot step, so a slow
// download never blocks the next caller from taking its own snapshot. The tail settles whether
// or not a snapshot fails, so one failure never blocks the backups after it.
let snapshotTail: Promise<unknown> = Promise.resolve()

/** Online SQLite snapshot of the live database, checked for corruption. Call cleanup() after. */
export function createBackupSnapshot(db: BazilionDb): Promise<BackupSnapshot> {
  const snapshot = snapshotTail.then(() => takeSnapshot(db))
  snapshotTail = snapshot.catch(() => {})
  return snapshot
}

async function takeSnapshot(db: BazilionDb): Promise<BackupSnapshot> {
  const directory = mkdtempSync(join(tmpdir(), 'bazilion-backup-'))
  const cleanup = () => rmSync(directory, { recursive: true, force: true })
  try {
    // A name other than bazilion.db, so the archive filter can tell it from the live file.
    const database = join(directory, 'bazilion.snapshot')
    await db.backupTo(database)
    const snapshot = new DatabaseSync(database, { readOnly: true })
    try {
      const check = snapshot.prepare('PRAGMA integrity_check').get()
      if (check?.integrity_check !== 'ok') {
        throw new Error(`SQLite snapshot failed integrity_check: ${check?.integrity_check}`)
      }
    } finally {
      snapshot.close()
    }
    return { directory, database, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * tar.gz of the home with the snapshot as `bazilion.db`. Left out: the live database and its
 * journals, the pidfile, qmd indexes (rebuilt from their Markdown) and browser profiles (they
 * hold site logins).
 */
export function createBackupArchive(paths: Paths, snapshot: BackupSnapshot) {
  const snapshotPath = resolve(snapshot.database)
  return create(
    {
      cwd: paths.home,
      gzip: true,
      portable: true,
      // The snapshot is an absolute path outside `cwd`; onWriteEntry renames it.
      preservePaths: true,
      strict: true,
      filter(path) {
        if (resolve(path) === snapshotPath) return true
        const entry = path.replace(/^\.\//, '')
        return !(
          entry === 'bazilion.db' ||
          entry.startsWith('bazilion.db-') ||
          entry === DAEMON_PID_FILE ||
          /^teams\/[^/]+\/memory\/\.qmd-index\.sqlite/.test(entry) ||
          entry === 'browsers' ||
          entry.startsWith('browsers/')
        )
      },
      onWriteEntry(entry) {
        if (resolve(entry.absolute) === snapshotPath) entry.path = './bazilion.db'
      },
    },
    ['.', snapshotPath],
  )
}
