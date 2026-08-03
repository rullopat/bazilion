import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { create } from 'tar'
import type { BazilionDb, Paths } from '../core/index.ts'

export interface BackupSnapshot {
  directory: string
  database: string
  cleanup(): void
}

// SQLite only supports one online-backup operation per source connection at a
// time. Queue the short snapshot step; archive compression and HTTP streaming
// happen after the queue is released, so one slow download cannot block the
// next caller from taking its own point-in-time snapshot.
let snapshotTail = Promise.resolve()

async function serializeSnapshot<T>(work: () => Promise<T>): Promise<T> {
  let release = () => {}
  const previous = snapshotTail
  snapshotTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

function assertSnapshotIntegrity(path: string): void {
  const snapshot = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = snapshot.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string
    }>
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
      const detail = rows.map((row) => row.integrity_check).join('; ') || 'no result'
      throw new Error(`SQLite snapshot failed integrity_check: ${detail}`)
    }
    const foreignKeyErrors = snapshot.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeyErrors.length > 0) {
      throw new Error(
        `SQLite snapshot failed foreign_key_check with ${foreignKeyErrors.length} violation(s)`,
      )
    }
  } finally {
    snapshot.close()
  }
}

/**
 * Take a verified SQLite online-backup snapshot while the daemon remains live.
 * The caller owns the returned temp directory and must invoke cleanup().
 */
export async function createBackupSnapshot(db: BazilionDb): Promise<BackupSnapshot> {
  return serializeSnapshot(async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazilion-backup-'))
    // Use a distinct source name so the archive filter can exclude the live
    // `bazilion.db` while still admitting this trusted snapshot overlay.
    const database = join(directory, 'bazilion.snapshot')
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      try {
        rmSync(directory, { recursive: true, force: true })
        cleaned = true
      } catch {
        // A stream end/cancel race (especially on Windows) may still hold the
        // file briefly. Leave `cleaned` false so the other lifecycle path can
        // retry rather than permanently suppressing cleanup.
      }
    }

    try {
      await db.backupTo(database)
      assertSnapshotIntegrity(database)
      return { directory, database, cleanup }
    } catch (error) {
      cleanup()
      throw error
    }
  })
}

/**
 * Archive the live filesystem around the verified database snapshot. The live
 * DB and its transient journals are excluded, then the snapshot is added under
 * the canonical `./bazilion.db` name. qmd indexes are caches and are rebuilt
 * from their Markdown sources after restore.
 */
export function createBackupArchive(paths: Paths, snapshot: BackupSnapshot) {
  const snapshotPath = resolve(snapshot.database)
  return create(
    {
      cwd: paths.home,
      gzip: true,
      portable: true,
      // The snapshot is an absolute, daemon-created path outside `cwd`. Its
      // entry name is rewritten below before the header is emitted. Every
      // user-controlled home entry still originates from the relative `.`.
      preservePaths: true,
      strict: true,
      filter(path) {
        if (resolve(path) === snapshotPath) return true
        const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
        if (normalized === 'bazilion.db' || normalized.startsWith('bazilion.db-')) return false
        if (
          normalized === 'daemon-runtime.json' ||
          normalized.startsWith('daemon-runtime.json.reclaim-')
        ) {
          return false
        }
        if (/^teams\/[^/]+\/memory\/\.qmd-index\.sqlite/.test(normalized)) return false
        return true
      },
      onWriteEntry(entry) {
        if (resolve(entry.absolute) === snapshotPath) entry.path = './bazilion.db'
      },
    },
    ['.', snapshotPath],
  )
}
