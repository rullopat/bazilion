import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../../../src/core/db/client.ts'
import { listMigrations, runMigrations, schemaMigrationsSql } from '../../../src/core/db/migrate.ts'

// ---------------------------------------------------------------------------
// Contract under test (BAZ-047): the migration chain is forward-only.
// - A fresh database runs the whole chain.
// - An existing home whose ledger is an unbroken prefix of the chain upgrades
//   in place, preserving data, and takes a pre-migration snapshot first.
// - A database written by a NEWER binary is refused untouched.
// - A home whose applied schema diverges from the canonical replay of its
//   ledger (edited-in-place migration, corruption) is refused untouched.
// ---------------------------------------------------------------------------

const files = listMigrations()

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'bazilion-migrate-'))
}

/** Build a faithful "old home": ledger + canonical replay of the first n migrations. */
function seedOldHome(home: string, n: number): { dbPath: string; db: ReturnType<typeof openDb> } {
  const dbPath = join(home, 'bazilion.db')
  const db = openDb(dbPath)
  db.raw.exec(schemaMigrationsSql)
  for (const file of files.slice(0, n)) db.raw.exec(file.sql)
  for (const file of files.slice(0, n)) {
    db.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
      file.version,
      Date.now(),
    ])
  }
  return { dbPath, db }
}

describe('migration contract', () => {
  it('runs the full chain on a fresh database and is idempotent', () => {
    const home = makeHome()
    try {
      const dbPath = join(home, 'bazilion.db')
      const db = openDb(dbPath)
      runMigrations(db)
      const applied = db.raw
        .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => r.version)
      expect(applied).toEqual(files.map((f) => f.version))

      // Second run: no-op, no duplicate ledger rows.
      runMigrations(db)
      const appliedAgain = db.raw
        .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM schema_migrations')
        .all()[0]!.count
      expect(appliedAgain).toBe(files.length)
      db.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not snapshot a fresh database', () => {
    const home = makeHome()
    try {
      const dbPath = join(home, 'bazilion.db')
      const snapshotPath = join(home, 'snapshot.db')
      const db = openDb(dbPath)
      runMigrations(db, { preMigrationSnapshotPath: snapshotPath })
      let exists = false
      try {
        readFileSync(snapshotPath)
        exists = true
      } catch {
        exists = false
      }
      expect(exists).toBe(false)
      db.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('upgrades an existing home in place, preserving data, and snapshots first', () => {
    if (files.length < 2) {
      // The contract is only observable when the chain has a migration an
      // old home has not applied yet. Skip while the chain is single-file.
      return
    }
    const home = makeHome()
    try {
      const { dbPath, db } = seedOldHome(home, 1)
      db.raw.run(`INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'Survivor',
        '',
        Date.now(),
      ])
      db.close()

      const snapshotPath = join(home, 'pre-migration.db')
      const reopened = openDb(dbPath)
      runMigrations(reopened, { preMigrationSnapshotPath: snapshotPath })

      // Ledger now covers the whole chain.
      const applied = reopened.raw
        .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => r.version)
      expect(applied).toEqual(files.map((f) => f.version))

      // Data written before the upgrade survives.
      const team = reopened.raw
        .query<{ name: string }, []>(`SELECT name FROM teams WHERE id = 'team-1'`)
        .all()
      expect(team).toEqual([{ name: 'Survivor' }])
      reopened.close()

      // The snapshot exists, is a valid SQLite database, and contains the
      // pre-upgrade data with the pre-upgrade ledger.
      const snapshot = openDb(snapshotPath)
      const snapTeam = snapshot.raw
        .query<{ name: string }, []>(`SELECT name FROM teams WHERE id = 'team-1'`)
        .all()
      expect(snapTeam).toEqual([{ name: 'Survivor' }])
      const snapLedger = snapshot.raw
        .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM schema_migrations')
        .all()[0]!.count
      expect(snapLedger).toBe(1)
      snapshot.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses a database written by a newer binary (numeric schema version), untouched', () => {
    const home = makeHome()
    try {
      const { dbPath, db } = seedOldHome(home, 1)
      db.raw.run(`INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'Future',
        '',
        Date.now(),
      ])
      db.raw.exec(`PRAGMA user_version = 999`)
      db.close()

      const reopened = openDb(dbPath)
      expect(() => runMigrations(reopened)).toThrow(/newer version/)

      // Untouched: the future schema version is still there and no data changed.
      const version = reopened.raw
        .query<Record<string, unknown>, []>('PRAGMA user_version')
        .all()[0]!['user_version'] as number
      expect(version).toBe(999)
      const team = reopened.raw
        .query<{ name: string }, []>(`SELECT name FROM teams WHERE id = 'team-1'`)
        .all()
      expect(team).toEqual([{ name: 'Future' }])
      reopened.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses a ledger containing a migration this binary does not know, untouched', () => {
    const home = makeHome()
    try {
      const { dbPath, db } = seedOldHome(home, 1)
      db.raw.run(`INSERT INTO teams (id, name, user_md, created_at) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'Ambiguous',
        '',
        Date.now(),
      ])
      // Unknown name: could be a newer release or a historical one — the
      // name-based ledger cannot tell, so the contract fails closed.
      db.raw.run(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, [
        '9999_from_the_future',
        Date.now(),
      ])
      db.close()

      const reopened = openDb(dbPath)
      expect(() => runMigrations(reopened)).toThrow(/incompatible database schema/)

      // Untouched: the unknown row is still there and no data changed.
      const applied = reopened.raw
        .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((r) => r.version)
      expect(applied).toContain('9999_from_the_future')
      const team = reopened.raw
        .query<{ name: string }, []>(`SELECT name FROM teams WHERE id = 'team-1'`)
        .all()
      expect(team).toEqual([{ name: 'Ambiguous' }])
      reopened.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('stamps the numeric schema version on a fully migrated home', () => {
    const home = makeHome()
    try {
      const dbPath = join(home, 'bazilion.db')
      const db = openDb(dbPath)
      runMigrations(db)
      const version = db.raw.query<Record<string, unknown>, []>('PRAGMA user_version').all()[0]![
        'user_version'
      ] as number
      expect(version).toBe(files.length)
      db.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses a home whose applied schema diverges from the canonical replay', () => {
    const home = makeHome()
    try {
      const { dbPath, db } = seedOldHome(home, 1)
      // Simulate an edited-in-place migration: a column the canonical 0001
      // replay does not have.
      db.raw.exec(`ALTER TABLE teams ADD COLUMN smuggled TEXT`)
      db.close()

      const reopened = openDb(dbPath)
      expect(() => runMigrations(reopened)).toThrow(/incompatible database schema/)
      reopened.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses to mutate a database without a migration ledger', () => {
    const home = makeHome()
    try {
      const dbPath = join(home, 'bazilion.db')
      const db = openDb(dbPath)
      db.raw.exec(`CREATE TABLE foreign_artifact (id TEXT PRIMARY KEY)`)
      db.close()

      const reopened = openDb(dbPath)
      expect(() => runMigrations(reopened)).toThrow(/incompatible database schema/)

      // The foreign table was not destroyed by the refusal.
      const tables = reopened.raw
        .query<{ name: string }, []>(`SELECT name FROM sqlite_schema WHERE type = 'table'`)
        .all()
        .map((r) => r.name)
      expect(tables).toContain('foreign_artifact')
      reopened.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
