// The database schema and its migrations. A fresh home gets `schema.sql`, the whole schema. An
// existing home carries its schema version in SQLite's `user_version` and is brought up to date by
// `migrations/NNN-name.sql`: each one turns version NNN - 1 into NNN, and `001-baseline.sql` is
// the schema homes had before they carried a version. The database is copied aside first, all
// pending migrations run in one transaction, and the transaction commits only when the result is
// exactly what `schema.sql` creates, so a failed upgrade leaves the home as it was.

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { type BazilionDb, inTx, openInMemoryDb } from './client.ts'

export const INCOMPATIBLE_DATABASE_MESSAGE =
  'Bazilion cannot start because this home uses an incompatible database schema. ' +
  'Preserve the entire Bazilion home directory as a filesystem backup first, keeping ' +
  'bazilion.db and auth.json together. Then perform the reset with ' +
  '`bazilion uninstall --yes` (from the repository root of a source checkout: ' +
  '`pnpm tsx apps/cli/src/index.ts uninstall --yes`) and start Bazilion again. ' +
  'Use `--all` only if you also want to remove installed skills.'

export class IncompatibleDatabaseError extends Error {
  /** `copies`: databases an earlier upgrade kept in upgrades/, which beat a reset. */
  constructor(copies: readonly string[] = []) {
    super(
      copies.length > 0
        ? 'This home keeps copies of its database from before an upgrade in upgrades/ ' +
            `(the latest: ${copies.at(-1)}). Putting the latest one back keeps your data and a ` +
            `reset does not: see docs/upgrades.md. ${INCOMPATIBLE_DATABASE_MESSAGE}`
        : INCOMPATIBLE_DATABASE_MESSAGE,
    )
    this.name = 'IncompatibleDatabaseError'
  }
}

/** A home a later release has already upgraded: this release must not open it. */
export class NewerDatabaseError extends Error {
  constructor(found: number, latest: number) {
    super(
      `Bazilion cannot start because a newer release has upgraded this home's database ` +
        `(schema ${found}; this release knows up to ${latest}). Install that release or a later ` +
        'one. To go back to this release, restore the copy of the database the upgrade kept in ' +
        'upgrades/ (see docs/upgrades.md).',
    )
    this.name = 'NewerDatabaseError'
  }
}

/**
 * A migration that failed. Normally nothing it did was kept; `copy` is set when part of it may have
 * been, and names the database as it was before.
 */
export class DatabaseUpgradeError extends Error {
  constructor(from: number, to: number, cause: unknown, copy?: string | null) {
    const why = cause instanceof Error ? cause.message : String(cause)
    super(
      copy === undefined
        ? `Bazilion could not upgrade this home's database from schema ${from} to ${to}, and ` +
            `left it unchanged: ${why}`
        : `Bazilion could not upgrade this home's database from schema ${from} to ${to}, and ` +
            `part of the upgrade may have been kept: ${why}. Put back the copy made first ` +
            `(${copy ?? 'none was made'}) as docs/upgrades.md says, and report this.`,
      { cause },
    )
    this.name = 'DatabaseUpgradeError'
  }
}

export type SchemaObject = { type: string; name: string; sql: string }
/** Runs a query and returns its rows, so daemon and raw node:sqlite handles share the check. */
export type ReadSchemaObjects = (query: string) => SchemaObject[]

export interface Migration {
  /** The schema version the migration produces; 1 is the baseline. */
  version: number
  name: string
  sql: string
}

/** The schema a release ships: the whole of it, and the migrations that lead to it. */
export interface SchemaPlan {
  schemaSql: string
  migrations: readonly Migration[]
}

/** What a home's database is, as far as this release can tell. */
export type HomeSchema =
  | { kind: 'empty' }
  | { kind: 'known'; version: number; stamped: boolean }
  | { kind: 'newer'; version: number }
  | { kind: 'unknown' }

/** What `initSchema` did. `copy` is the database as it was before an upgrade. */
export type SchemaOutcome =
  | { kind: 'created'; version: number }
  | { kind: 'current'; version: number }
  | { kind: 'upgraded'; from: number; to: number; copy: string | null }

const SCHEMA_OBJECTS =
  'SELECT type, name, sql FROM sqlite_schema ' +
  "WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name"

const MIGRATION_FILE = /^(\d{3})-[a-z0-9][a-z0-9-]*\.sql$/
// The upgrade owns the transaction and these pragmas. A trigger's BEGIN and END are inside its
// CREATE statement, so only a statement that starts with one of these words is refused; a bare
// `END;` that ends a transaction is caught when the migration runs instead.
const FORBIDDEN_STATEMENT =
  /(?:^|;)\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ATTACH|DETACH|END\s+TRANSACTION|PRAGMA\s+(?:foreign_keys|user_version|journal_mode))\b/i

// SQLite stores each CREATE statement's text, comments included. `ALTER TABLE ADD COLUMN` appends
// to that text with spacing of its own, and `ALTER TABLE RENAME` writes the new name in double
// quotes. Ignore comments, whitespace, the spaces around brackets and commas, and double quotes
// around names, so that neither documentation edits to schema.sql nor the way a migration changed
// a table make a home look different.
function fingerprint(read: ReadSchemaObjects): string {
  return read(SCHEMA_OBJECTS)
    .map((object) => {
      const sql = object.sql
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/"/g, '')
        .replace(/\s+/g, ' ')
        .replace(/ ?([(),]) ?/g, '$1')
        .trim()
      return `${object.type} ${object.name} ${sql}`
    })
    .join('\n')
}

/** The migrations in `dir`, checked to be numbered 001, 002, … without gaps. */
export function loadMigrations(dir: URL): Migration[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const migrations = names.map((name, index) => {
    const version = Number(MIGRATION_FILE.exec(name)?.[1])
    if (version !== index + 1) {
      throw new Error(`migrations must be named 001-name.sql, 002-name.sql, … found ${name}`)
    }
    const sql = readFileSync(new URL(name, dir), 'utf8')
    const forbidden = FORBIDDEN_STATEMENT.exec(sql.replace(/--[^\n]*/g, ' '))?.[1]
    if (forbidden) throw new Error(`${name} must not contain ${forbidden.toUpperCase()}`)
    return { version, name, sql }
  })
  if (migrations.length === 0) throw new Error('no migrations found, not even the baseline')
  return migrations
}

let shipped: SchemaPlan | undefined
/** This release's schema, read once from the files next to this module (or `dist/`). */
export function shippedSchema(): SchemaPlan {
  shipped ??= {
    schemaSql: readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'),
    migrations: loadMigrations(new URL('./migrations/', import.meta.url)),
  }
  return shipped
}

const fingerprints = new WeakMap<SchemaPlan, Map<number, string>>()
/** The schema of `version`: the release's whole schema for the latest, else its migrations. */
function expectedFingerprint(plan: SchemaPlan, version: number): string {
  let known = fingerprints.get(plan)
  if (!known) {
    known = new Map()
    fingerprints.set(plan, known)
  }
  const cached = known.get(version)
  if (cached !== undefined) return cached
  const scratch = openInMemoryDb('')
  try {
    if (version === plan.migrations.length) scratch.raw.exec(plan.schemaSql)
    else for (const migration of plan.migrations.slice(0, version)) scratch.raw.exec(migration.sql)
    const value = fingerprint((query) => scratch.raw.query<SchemaObject, []>(query).all())
    known.set(version, value)
    return value
  } finally {
    scratch.close()
  }
}

/**
 * Which schema a database has. `userVersion` is its `PRAGMA user_version`: 0 means a home from
 * before versions, which must be exactly the baseline.
 */
export function readHomeSchema(
  read: ReadSchemaObjects,
  userVersion: number,
  plan: SchemaPlan = shippedSchema(),
): HomeSchema {
  if (read(SCHEMA_OBJECTS).length === 0) return { kind: 'empty' }
  if (userVersion > plan.migrations.length) return { kind: 'newer', version: userVersion }
  const version = userVersion === 0 ? 1 : userVersion
  if (fingerprint(read) !== expectedFingerprint(plan, version)) return { kind: 'unknown' }
  return { kind: 'known', version, stamped: userVersion !== 0 }
}

function userVersion(db: BazilionDb): number {
  return db.raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0
}

function setUserVersion(db: BazilionDb, version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new Error(`bad schema version ${version}`)
  db.raw.exec(`PRAGMA user_version = ${version}`)
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * A consistent copy of the database in `dir`, made before an upgrade touches it. It is written
 * under a temporary name and on disk before it takes its own, so a file with a copy's name is a
 * whole copy, even after a power cut.
 */
function copyBeforeUpgrade(db: BazilionDb, dir: string, version: number): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `bazilion-schema-${version}-${stamp}.db`)
  const partial = `${file}.partial`
  try {
    db.raw.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`)
    chmodSync(partial, 0o600)
    fsyncPath(partial)
    renameSync(partial, file)
    fsyncPath(dir)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
  return file
}

/** The copies earlier upgrades kept in `dir`, oldest first. */
function keptCopies(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^bazilion-schema-\d+-.*\.db$/.test(name))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

/** Raised inside the upgrade when a migration ended the transaction itself. */
class TransactionEnded extends Error {}

/** Apply the migrations after `from`; on failure, say whether the home may have changed. */
function migrate(db: BazilionDb, plan: SchemaPlan, from: number, copy: string | null): void {
  const read: ReadSchemaObjects = (query) => db.raw.query<SchemaObject, []>(query).all()
  const latest = plan.migrations.length
  // A migration may rebuild a table; foreign keys are checked once at the end instead of per
  // statement. The pragma has no effect inside a transaction, so it is set around it.
  db.raw.exec('PRAGMA foreign_keys = OFF')
  try {
    inTx(db, () => {
      for (const migration of plan.migrations.slice(from)) {
        try {
          db.raw.exec(migration.sql)
        } catch (error) {
          throw new Error(`${migration.name}: ${(error as Error).message}`)
        }
        if (!db.raw.inTransaction()) {
          throw new TransactionEnded(`${migration.name} ended the upgrade's transaction itself`)
        }
      }
      const broken = db.raw.query<{ table: string }, []>('PRAGMA foreign_key_check').all()
      if (broken.length > 0) {
        const tables = [...new Set(broken.map((row) => row.table))].join(', ')
        throw new Error(`rows of ${tables} point at rows that no longer exist`)
      }
      if (fingerprint(read) !== expectedFingerprint(plan, latest)) {
        throw new Error('the result differs from the schema this release ships')
      }
      setUserVersion(db, latest)
    })
  } catch (error) {
    if (error instanceof TransactionEnded) throw new DatabaseUpgradeError(from, latest, error, copy)
    // Rolled back, so the copy is the same as the home: drop it, so that retries do not pile up.
    if (copy) rmSync(copy, { force: true })
    throw new DatabaseUpgradeError(from, latest, error)
  } finally {
    db.raw.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * Bring a home's database to this release's schema: create it in an empty database, upgrade an
 * older one (copied into `copyDir` first, when given), and refuse, untouched, one that is newer or
 * unknown. `beforeUpgrade` runs once an upgrade is due and before anything is written, so a check
 * that fails (auth.json against the database) leaves the home as it was.
 */
export function initSchema(
  db: BazilionDb,
  options: { copyDir?: string; plan?: SchemaPlan; beforeUpgrade?: () => void } = {},
): SchemaOutcome {
  const plan = options.plan ?? shippedSchema()
  const latest = plan.migrations.length
  const read: ReadSchemaObjects = (query) => db.raw.query<SchemaObject, []>(query).all()
  const home = readHomeSchema(read, userVersion(db), plan)
  switch (home.kind) {
    case 'empty':
      inTx(db, () => {
        db.raw.exec(plan.schemaSql)
        setUserVersion(db, latest)
      })
      return { kind: 'created', version: latest }
    case 'newer':
      throw new NewerDatabaseError(home.version, latest)
    case 'unknown':
      throw new IncompatibleDatabaseError(keptCopies(options.copyDir))
    case 'known': {
      if (home.version === latest) {
        if (!home.stamped) setUserVersion(db, latest)
        return { kind: 'current', version: latest }
      }
      options.beforeUpgrade?.()
      let copy: string | null = null
      if (options.copyDir) {
        try {
          copy = copyBeforeUpgrade(db, options.copyDir, home.version)
        } catch (error) {
          const cause = new Error(`the copy made first failed: ${(error as Error).message}`)
          throw new DatabaseUpgradeError(home.version, latest, cause)
        }
      }
      migrate(db, plan, home.version, copy)
      return { kind: 'upgraded', from: home.version, to: latest, copy }
    }
  }
}
