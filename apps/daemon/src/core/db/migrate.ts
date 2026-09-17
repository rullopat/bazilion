import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { type BazilionDb, openInMemoryDb } from './client.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
export const schemaMigrationsSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`

export const INCOMPATIBLE_DATABASE_MESSAGE =
  'Bazilion cannot start because this home uses an incompatible database schema. ' +
  'Preserve the entire Bazilion home directory as a filesystem backup first, keeping ' +
  'bazilion.db and auth.json together. Then perform the reset with ' +
  '`bazilion uninstall --yes` (from the repository root of a source checkout: ' +
  '`pnpm tsx apps/cli/src/index.ts uninstall --yes`) and start Bazilion again. ' +
  'Use `--all` only if you also want to remove logs and installed skills.'

export class IncompatibleDatabaseError extends Error {
  constructor() {
    super(INCOMPATIBLE_DATABASE_MESSAGE)
    this.name = 'IncompatibleDatabaseError'
  }
}

export class DatabaseNewerThanBinaryError extends Error {
  constructor(dbVersion: number, supportedVersion: number) {
    super(
      'Bazilion cannot start because this home was written by a newer version: its ' +
        `database schema version (${dbVersion}) is newer than this binary supports (${supportedVersion}). ` +
        'Upgrade Bazilion to a release that supports this schema. Downgrades are unsupported; ' +
        'if you must run an older release, restore a pre-upgrade snapshot instead.',
    )
    this.name = 'DatabaseNewerThanBinaryError'
  }
}

export interface MigrationFile {
  version: string
  sql: string
}

export function listMigrations(): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      version: file.replace(/\.sql$/, ''),
      sql: readFileSync(join(migrationsDir, file), 'utf8'),
    }))
}

export interface RunMigrationsOptions {
  /**
   * Path for a pre-migration snapshot of an existing home. When pending
   * migrations are about to be applied to a database that already has applied
   * migrations, the live database is copied here first (via `VACUUM INTO`,
   * which is synchronous, transactionally consistent, and refuses to overwrite
   * an existing file). A failed migration then leaves the operator a restorable
   * copy. Omit on fresh databases and in tests with throwaway homes.
   */
  preMigrationSnapshotPath?: string
}

interface SchemaObject {
  type: string
  name: string
  tbl_name: string
  sql: string
}

const canonicalSchemaObjectsByPrefix = new Map<number, SchemaObject[]>()

function schemaObjects(db: BazilionDb): SchemaObject[] {
  return db.raw
    .query<SchemaObject, []>(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_'
       ORDER BY type, name`,
    )
    .all()
}

function schemaPayload(rows: SchemaObject[]): string {
  return rows
    .map((row) => [row.type, row.name, row.tbl_name, normalizeSql(row.sql)].join('\0'))
    .join('\n')
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/**
 * Replay the first `prefixLength` migrations of the chain in a scratch
 * in-memory database and return the resulting schema objects. Result is
 * cached per prefix length. This is the integrity yardstick: a home whose
 * applied prefix disagrees with the canonical replay has been tampered with,
 * corrupted, or written by a foreign release.
 */
function expectedSchema(files: MigrationFile[], prefixLength: number): SchemaObject[] {
  const cached = canonicalSchemaObjectsByPrefix.get(prefixLength)
  if (cached) return cached

  const canonical = openInMemoryDb()
  try {
    canonical.raw.exec(schemaMigrationsSql)
    for (const file of files.slice(0, prefixLength)) canonical.raw.exec(file.sql)
    const objects = schemaObjects(canonical)
    canonicalSchemaObjectsByPrefix.set(prefixLength, objects)
    return objects
  } finally {
    canonical.close()
  }
}

/**
 * Numeric schema version: equal to the number of migrations in the chain.
 * Stored in `PRAGMA user_version` by runMigrations once a home has applied the
 * full chain. A database whose user_version exceeds this binary's version was
 * written by a newer release and is refused (downgrades are unsupported).
 * Homes from before this contract (user_version 0) are dated by their ledger
 * instead: an applied-version name unknown to this binary means the home is
 * from a newer OR an unsupported historical release — indistinguishable from
 * a name-based ledger, so it fails closed as incompatible.
 */
export function currentSchemaVersion(): number {
  return listMigrations().length
}

/**
 * Enforce the schema contract before any runtime work starts.
 *
 * - A fresh database may contain only the empty migration ledger.
 * - An initialized database must have applied an unbroken prefix of this
 *   binary's migration chain, and its schema must byte-match the canonical
 *   replay of exactly that prefix. Pending migrations are allowed: an older
 *   home upgrades forward on open.
 * - A database whose numeric schema version exceeds this binary's was written
 *   by a newer release and is refused (DatabaseNewerThanBinaryError).
 * - An applied-version name unknown to this binary (newer or historical)
 *   fails closed as incompatible.
 */
export function assertMigrationCompatibility(db: BazilionDb): void {
  const files = listMigrations()
  const expectedVersions = files.map((file) => file.version)

  const dbUserVersion = userVersion(db)
  if (dbUserVersion > files.length) {
    throw new DatabaseNewerThanBinaryError(dbUserVersion, files.length)
  }

  let appliedVersions: string[]
  try {
    appliedVersions = db.raw
      .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version)
  } catch {
    throw new IncompatibleDatabaseError()
  }

  if (appliedVersions.length === 0) {
    const actualObjects = schemaObjects(db)
    const migrationTable = actualObjects.filter(
      (row) => row.type === 'table' && row.name === 'schema_migrations',
    )
    const expectedMigrationTable = expectedSchema(files, 0).filter(
      (row) => row.type === 'table' && row.name === 'schema_migrations',
    )
    if (
      actualObjects.length !== 1 ||
      migrationTable.length !== 1 ||
      schemaPayload(migrationTable) !== schemaPayload(expectedMigrationTable)
    ) {
      throw new IncompatibleDatabaseError()
    }
    return
  }

  const expectedSet = new Set(expectedVersions)
  const isPrefix =
    appliedVersions.every((version) => expectedSet.has(version)) &&
    appliedVersions.length <= expectedVersions.length &&
    appliedVersions.every((version, index) => version === expectedVersions[index])
  if (!isPrefix) {
    throw new IncompatibleDatabaseError()
  }

  const actualObjects = schemaObjects(db)
  const expectedObjects = expectedSchema(files, appliedVersions.length)
  if (schemaPayload(actualObjects) !== schemaPayload(expectedObjects)) {
    throw new IncompatibleDatabaseError()
  }
}

export function runMigrations(db: BazilionDb, options: RunMigrationsOptions = {}): void {
  const existingObjects = schemaObjects(db)
  if (
    existingObjects.length > 0 &&
    !existingObjects.some((row) => row.type === 'table' && row.name === 'schema_migrations')
  ) {
    // Do not mutate an unknown pre-ledger/corrupt database merely to discover
    // that it is incompatible with the contract.
    throw new IncompatibleDatabaseError()
  }
  db.raw.exec(schemaMigrationsSql)
  assertMigrationCompatibility(db)

  const applied = new Set(
    db.raw
      .query<{ version: string }, []>('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  )

  const files = listMigrations()
  const pending = files.filter((file) => !applied.has(file.version))

  if (pending.length > 0 && applied.size > 0 && options.preMigrationSnapshotPath !== undefined) {
    // Preserve the pre-upgrade state before the first forward migration.
    // `VACUUM INTO` is synchronous and fails if the target already exists, so
    // a retried upgrade never overwrites the snapshot from a failed attempt.
    // Integrity-verify the copy before touching the live schema; if the
    // snapshot is unusable, refuse to migrate (fail closed, operator retries).
    db.raw.exec(`VACUUM INTO '${options.preMigrationSnapshotPath.replaceAll("'", "''")}'`)
    verifySnapshot(options.preMigrationSnapshotPath)
  }

  for (const file of pending) {
    const tx = db.raw.transaction(() => {
      db.raw.exec(file.sql)
      db.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        file.version,
        Date.now(),
      ])
    })
    tx()
  }

  // Stamp the numeric schema version once the full chain is applied, so a
  // future binary can refuse a newer database even if migration names change.
  if (userVersion(db) < files.length) {
    db.raw.exec(`PRAGMA user_version = ${files.length}`)
  }

  assertMigrationCompatibility(db)
}

function userVersion(db: BazilionDb): number {
  const row = db.raw.query<Record<string, unknown>, []>('PRAGMA user_version').all()[0]
  const value = row?.user_version
  return typeof value === 'number' ? value : Number(value ?? 0)
}

/**
 * Prove a database (typically a backup snapshot about to be restored) is
 * byte-equivalent to the current release's fully-migrated canonical schema:
 * its ledger must list the complete migration chain, and its schema objects
 * must match the canonical replay. Throws with an actionable message on any
 * mismatch. Accepts a raw node:sqlite handle so non-daemon consumers (the
 * CLI's backup/restore path) can validate without opening a full BazilionDb.
 */
export function assertSchemaMatchesCanonicalChain(raw: DatabaseSync): void {
  const files = listMigrations()
  const expectedVersions = files.map((file) => file.version)
  const applied = (
    raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
      version: string
    }>
  ).map((row) => row.version)
  if (
    applied.length !== expectedVersions.length ||
    applied.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error(
      `schema_migrations must contain exactly ${expectedVersions.join(', ')}; found ` +
        (applied.join(', ') || 'none'),
    )
  }
  const rows = raw
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_'
       ORDER BY type, name`,
    )
    .all() as unknown as Array<{ type: string; name: string; tbl_name: string; sql: string }>
  const canonical = expectedSchema(files, files.length)

  // Per-object diff first: restore failures deserve actionable detail
  // (which object is missing or unexpected), not just a fingerprint mismatch.
  const canonicalKeys = new Set(canonical.map((row) => `${row.type}\0${row.name}`))
  const actualKeys = new Map(rows.map((row) => [`${row.type}\0${row.name}`, row]))
  for (const row of canonical) {
    if (!actualKeys.has(`${row.type}\0${row.name}`)) {
      throw new Error(`required canonical schema ${row.type} is missing: ${row.name}`)
    }
  }
  for (const row of rows) {
    if (!canonicalKeys.has(`${row.type}\0${row.name}`)) {
      throw new Error(`unexpected schema ${row.type} is not canonical: ${row.name}`)
    }
  }

  // Same object set — now verify the SQL of each object is unaltered.
  const payload = rows
    .map((row) => [row.type, row.name, row.tbl_name, normalizeSql(row.sql)].join('\0'))
    .join('\n')
  const canonicalPayload = canonical
    .map((row) => [row.type, row.name, row.tbl_name, normalizeSql(row.sql)].join('\0'))
    .join('\n')
  if (payload !== canonicalPayload) {
    throw new Error(
      'database schema does not match this release’s canonical migration chain; ' +
        'restore a backup created from the current release',
    )
  }
}

function verifySnapshot(path: string): void {
  const snapshot = new DatabaseSync(path)
  try {
    const row = snapshot.prepare('PRAGMA integrity_check').get() as {
      integrity_check?: unknown
    }
    if (row.integrity_check !== 'ok') {
      throw new Error(
        `Pre-migration snapshot failed integrity check: ${String(row.integrity_check)}`,
      )
    }
  } finally {
    snapshot.close()
  }
}
