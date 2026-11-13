import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type BazilionDb, openDb, openInMemoryDb } from '../../src/core/db/client.ts'
import {
  INCOMPATIBLE_DATABASE_MESSAGE,
  IncompatibleDatabaseError,
  initSchema,
} from '../../src/core/db/schema.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

const schemaSql = readFileSync(new URL('../../src/core/db/schema.sql', import.meta.url), 'utf8')

let env: TestEnv
beforeAll(() => {
  env = makeTestEnv()
})
afterAll(() => env.cleanup())

function objectNames(db: BazilionDb): string[] {
  return db.raw
    .query<{ name: string }, []>(
      "SELECT type || ' ' || name AS name FROM sqlite_schema WHERE substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
    )
    .all()
    .map((r) => r.name)
}

function columns(db: BazilionDb, table: string): string[] {
  return db.raw
    .query<{ name: string }, [string]>('SELECT name FROM pragma_table_info(?)')
    .all(table)
    .map((r) => r.name)
}

function withHome(fn: (dbPath: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-schema-'))
  try {
    fn(join(home, 'bazilion.db'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('a fresh database gets the whole schema and restarts on the same home unchanged', () => {
  const reference = openInMemoryDb('')
  reference.raw.exec(schemaSql)
  const expected = objectNames(reference)
  reference.close()

  withHome((dbPath) => {
    const db = openDb(dbPath)
    initSchema(db)
    expect(objectNames(db)).toEqual(expected)
    db.raw.run("INSERT INTO config (key, value, updated_at) VALUES ('kept', 'yes', 1)")
    db.close()

    const reopened = openDb(dbPath)
    try {
      initSchema(reopened)
      expect(objectNames(reopened)).toEqual(expected)
      expect(
        reopened.raw
          .query<{ value: string }, []>("SELECT value FROM config WHERE key = 'kept'")
          .get()?.value,
      ).toBe('yes')
    } finally {
      reopened.close()
    }
  })
})

test('a home whose schema differs is refused untouched, with reset guidance', () => {
  withHome((dbPath) => {
    const db = openDb(dbPath)
    initSchema(db)
    db.raw.exec('ALTER TABLE teams ADD COLUMN smuggled TEXT')
    db.close()

    const reopened = openDb(dbPath)
    try {
      expect(() => initSchema(reopened)).toThrow(IncompatibleDatabaseError)
      expect(columns(reopened, 'teams')).toContain('smuggled')
    } finally {
      reopened.close()
    }
  })

  // A changed constraint is a different schema too, even with no rows that violate it.
  const olderSql = schemaSql.replace(
    "transport IN ('stdio','http')",
    "transport IN ('stdio','http','sse')",
  )
  expect(olderSql).not.toBe(schemaSql)
  const older = openInMemoryDb('')
  try {
    older.raw.exec(olderSql)
    expect(() => initSchema(older)).toThrow(INCOMPATIBLE_DATABASE_MESSAGE)
  } finally {
    older.close()
  }
  expect(INCOMPATIBLE_DATABASE_MESSAGE).toContain('entire Bazilion home directory')
  expect(INCOMPATIBLE_DATABASE_MESSAGE).toContain('bazilion.db and auth.json together')
  expect(INCOMPATIBLE_DATABASE_MESSAGE).toContain('bazilion uninstall --yes')
  expect(INCOMPATIBLE_DATABASE_MESSAGE).toContain('pnpm tsx apps/cli/src/index.ts uninstall --yes')
})

test('a foreign database is refused without gaining schema objects', () => {
  const foreign = openInMemoryDb('')
  try {
    foreign.raw.exec('CREATE TABLE groups (id TEXT PRIMARY KEY)')
    expect(() => initSchema(foreign)).toThrow(IncompatibleDatabaseError)
    expect(objectNames(foreign)).toEqual(['table groups'])
  } finally {
    foreign.close()
  }
})

test('comment and whitespace edits to schema.sql do not invalidate an existing home', () => {
  const edited = schemaSql
    .replaceAll(',\n', ', -- a reworded note\n')
    .replaceAll('(\n', '( /* a block note */\n')
    .replaceAll('\n  ', '\n\t\t')
  const home = openInMemoryDb('')
  try {
    home.raw.exec(edited)
    // SQLite keeps comments inside CREATE statements, so the stored text really differs.
    expect(
      home.raw
        .query<{ sql: string }, []>("SELECT sql FROM sqlite_schema WHERE name = 'teams'")
        .get()?.sql,
    ).toContain('a reworded note')
    expect(() => initSchema(home)).not.toThrow()
  } finally {
    home.close()
  }
})

test('schema checks do not mistake a LIKE wildcard for the reserved sqlite_ prefix', () => {
  env.db.raw.exec('CREATE TABLE sqliteXunexpected (id TEXT PRIMARY KEY)')
  try {
    expect(() => initSchema(env.db)).toThrow(IncompatibleDatabaseError)
  } finally {
    env.db.raw.exec('DROP TABLE sqliteXunexpected')
  }
})

test('the schema creates the expected tables', () => {
  const tables = env.db.raw
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((r) => r.name)

  for (const t of [
    'agent_skills',
    'agents',
    'teams',
    'team_template_edges',
    'team_template_slots',
    'team_templates',
    'team_policy_edges',
    'messages',
    'profile_default_skills',
    'profiles',
  ]) {
    expect(tables).toContain(t)
  }
  // Retired tables are absent from the canonical schema.
  expect(tables).not.toContain('agent_workspaces')
  expect(tables).not.toContain('profile_workspaces')
  expect(tables).not.toContain('workspaces')
  expect(tables).not.toContain('runs')
  expect(tables).not.toContain('events')
  expect(tables).not.toContain('profile_groups')
  expect(tables).not.toContain('profile_group_members')
  expect(tables).not.toContain('schema_migrations')
  expect(tables).not.toContain('team_policies')
  expect(tables).not.toContain('team_policy_block_events')
})

test('profiles table has skills_mode and no default_workspace_id', () => {
  const cols = columns(env.db, 'profiles')
  expect(cols).toContain('skills_mode')
  expect(cols).not.toContain('default_workspace_id')
})

test('agents table has team_id; teams table has user_md and policy_mode', () => {
  expect(columns(env.db, 'agents')).toContain('team_id')
  expect(columns(env.db, 'teams')).toContain('user_md')
  expect(columns(env.db, 'teams')).toContain('policy_mode')
})

test('nested transactions use savepoints without weakening outer rollback', () => {
  env.db.raw.transaction(() => {
    env.db.raw.run("INSERT INTO config (key, value, updated_at) VALUES ('outer', '1', 1)")
    expect(() =>
      env.db.raw.transaction(() => {
        env.db.raw.run("INSERT INTO config (key, value, updated_at) VALUES ('outer', '2', 2)")
      })(),
    ).toThrow()
    env.db.raw.run("INSERT INTO config (key, value, updated_at) VALUES ('after', '3', 3)")
  })()
  expect(
    env.db.raw.query<{ value: string }, []>("SELECT value FROM config WHERE key = 'after'").get()
      ?.value,
  ).toBe('3')

  expect(() =>
    env.db.raw.transaction(() => {
      env.db.raw.transaction(() => {
        env.db.raw.run("INSERT INTO config (key, value, updated_at) VALUES ('nested', '4', 4)")
      })()
      throw new Error('rollback outer')
    })(),
  ).toThrow(/rollback outer/)
  expect(
    env.db.raw.query<{ value: string }, []>("SELECT value FROM config WHERE key = 'nested'").get(),
  ).toBeNull()
})

test('Team template slots restrict Profile deletion', () => {
  const fks = env.db.raw
    .query<{ table: string; from: string; on_delete: string }, []>(
      'SELECT "table", "from", on_delete FROM pragma_foreign_key_list(\'team_template_slots\')',
    )
    .all()
  const profileFk = fks.find((f) => f.table === 'profiles' && f.from === 'profile_id')
  expect(profileFk).toBeDefined()
  expect(profileFk?.on_delete).toBe('RESTRICT')

  const parentFk = fks.find((f) => f.table === 'team_templates')
  expect(parentFk?.on_delete).toBe('CASCADE')
})

test('foreign keys are enforced', () => {
  expect(() =>
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, team_id, created_at)
       VALUES ('a1', 'nope', 'x', 'idle', 'test-team', ?)`,
      [Date.now()],
    ),
  ).toThrow()
})

test('schema has telegram columns on agents and teams', () => {
  const agentCols = columns(env.db, 'agents')
  expect(agentCols).toContain('telegram_topic_id')
  expect(agentCols).toContain('telegram_icon_emoji')
  expect(columns(env.db, 'teams')).toContain('telegram_icon_color')

  // The partial unique index on telegram_topic_id exists and enforces 1:1
  // (NULLs are allowed by the WHERE clause).
  const idxs = env.db.raw
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agents'",
    )
    .all()
    .map((r) => r.name)
  expect(idxs).toContain('idx_agents_telegram_topic_id')
})
