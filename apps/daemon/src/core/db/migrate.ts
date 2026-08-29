import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BazilionDb, openInMemoryDb } from './client.ts'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const schemaMigrationsSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`

export const INCOMPATIBLE_DATABASE_MESSAGE =
  'Bazilion cannot start because this home uses an incompatible alpha database schema. ' +
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

interface MigrationFile {
  version: string
  sql: string
}

interface SchemaObject {
  type: string
  name: string
  tbl_name: string
  sql: string
}

let canonicalSchemaObjects: SchemaObject[] | null = null

function migrationFiles(): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      version: file.replace(/\.sql$/, ''),
      sql: readFileSync(join(migrationsDir, file), 'utf8'),
    }))
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

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

function expectedSchema(files: MigrationFile[]): SchemaObject[] {
  if (canonicalSchemaObjects !== null) return canonicalSchemaObjects

  const canonical = openInMemoryDb()
  try {
    canonical.raw.exec(schemaMigrationsSql)
    for (const file of files) canonical.raw.exec(file.sql)
    canonicalSchemaObjects = schemaObjects(canonical)
    return canonicalSchemaObjects
  } finally {
    canonical.close()
  }
}

/**
 * Enforce the alpha clean-install database contract before any runtime work
 * starts. A fresh database may contain only the empty migration ledger; an
 * initialized database must match this release's ledger and complete schema.
 */
export function assertMigrationCompatibility(db: BazilionDb): void {
  const files = migrationFiles()
  const expectedVersions = files.map((file) => file.version)
  let appliedVersions: string[]
  try {
    appliedVersions = db.raw
      .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version)
  } catch {
    throw new IncompatibleDatabaseError()
  }

  const actualObjects = schemaObjects(db)
  const expectedObjects = expectedSchema(files)

  if (appliedVersions.length === 0) {
    const migrationTable = actualObjects.filter(
      (row) => row.type === 'table' && row.name === 'schema_migrations',
    )
    const expectedMigrationTable = expectedObjects.filter(
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

  if (
    appliedVersions.length !== expectedVersions.length ||
    appliedVersions.some((version, index) => version !== expectedVersions[index]) ||
    schemaPayload(actualObjects) !== schemaPayload(expectedObjects)
  ) {
    throw new IncompatibleDatabaseError()
  }
}

export function runMigrations(db: BazilionDb): void {
  const existingObjects = schemaObjects(db)
  if (
    existingObjects.length > 0 &&
    !existingObjects.some((row) => row.type === 'table' && row.name === 'schema_migrations')
  ) {
    // Do not mutate an unknown pre-ledger/corrupt database merely to discover
    // that it is incompatible with the clean-install contract.
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

  for (const file of migrationFiles()) {
    if (applied.has(file.version)) continue
    const tx = db.raw.transaction(() => {
      db.raw.exec(file.sql)
      db.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        file.version,
        Date.now(),
      ])
    })
    tx()
  }

  assertMigrationCompatibility(db)
}
