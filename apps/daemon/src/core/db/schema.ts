import { readFileSync } from 'node:fs'
import { type BazilionDb, inTx, openInMemoryDb } from './client.ts'

export const INCOMPATIBLE_DATABASE_MESSAGE =
  'Bazilion cannot start because this home uses an incompatible database schema. ' +
  'Preserve the entire Bazilion home directory as a filesystem backup first, keeping ' +
  'bazilion.db and auth.json together. Then perform the reset with ' +
  '`bazilion uninstall --yes` (from the repository root of a source checkout: ' +
  '`pnpm tsx apps/cli/src/index.ts uninstall --yes`) and start Bazilion again. ' +
  'Use `--all` only if you also want to remove installed skills.'

export class IncompatibleDatabaseError extends Error {
  constructor() {
    super(INCOMPATIBLE_DATABASE_MESSAGE)
    this.name = 'IncompatibleDatabaseError'
  }
}

export type SchemaObject = { type: string; name: string; sql: string }
/** Runs a query and returns its rows, so daemon and raw node:sqlite handles share the check. */
type ReadSchemaObjects = (query: string) => SchemaObject[]

const SCHEMA_OBJECTS =
  'SELECT type, name, sql FROM sqlite_schema ' +
  "WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name"

// SQLite stores each CREATE statement's text, comments included. Ignore comments and whitespace so
// that documentation edits to schema.sql never make an existing home look incompatible.
function fingerprint(read: ReadSchemaObjects): string {
  return read(SCHEMA_OBJECTS)
    .map((object) => {
      const sql = object.sql
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return `${object.type} ${object.name} ${sql}`
    })
    .join('\n')
}

let schemaSql: string | undefined
function readSchemaSql(): string {
  schemaSql ??= readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  return schemaSql
}

let canonical: string | undefined
/** True when the database's schema objects are exactly those `schema.sql` creates. */
export function schemaMatches(read: ReadSchemaObjects): boolean {
  if (canonical === undefined) {
    const scratch = openInMemoryDb('')
    try {
      scratch.raw.exec(readSchemaSql())
      canonical = fingerprint((query) => scratch.raw.query<SchemaObject, []>(query).all())
    } finally {
      scratch.close()
    }
  }
  return fingerprint(read) === canonical
}

/** Create the schema in an empty database; refuse, untouched, a database whose schema differs. */
export function initSchema(db: BazilionDb): void {
  const read: ReadSchemaObjects = (query) => db.raw.query<SchemaObject, []>(query).all()
  if (read(SCHEMA_OBJECTS).length === 0) inTx(db, () => db.raw.exec(readSchemaSql()))
  else if (!schemaMatches(read)) throw new IncompatibleDatabaseError()
}
