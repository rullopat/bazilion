import { afterAll, beforeAll, expect, test } from 'vitest'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeAll(() => {
  env = makeTestEnv()
})
afterAll(() => env.cleanup())

test('migrations create all expected tables', () => {
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
    'team_template_revision_edges',
    'team_template_revision_slots',
    'team_template_revisions',
    'team_template_slots',
    'team_templates',
    'team_agent_state',
    'team_policy_edges',
    'team_policies',
    'messages',
    'profile_default_skills',
    'profile_communication_defaults',
    'profiles',
    'schema_migrations',
    'source_slot_bindings',
    'template_instantiations',
  ]) {
    expect(tables).toContain(t)
  }
  // Junction tables dropped in 0005; runs + events dropped in 0003.
  expect(tables).not.toContain('agent_workspaces')
  expect(tables).not.toContain('profile_workspaces')
  expect(tables).not.toContain('workspaces')
  expect(tables).not.toContain('runs')
  expect(tables).not.toContain('events')
  expect(tables).not.toContain('profile_groups')
  expect(tables).not.toContain('profile_group_members')
})

test('profiles table has skills_mode and no default_workspace_id', () => {
  const cols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('profiles')")
    .all()
    .map((r) => r.name)
  expect(cols).toContain('skills_mode')
  expect(cols).not.toContain('default_workspace_id')
})

test('agents table has team_id; teams table has user_md', () => {
  const agentCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
    .all()
    .map((r) => r.name)
  expect(agentCols).toContain('team_id')

  const groupCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('teams')")
    .all()
    .map((r) => r.name)
  expect(groupCols).toContain('user_md')
})

test('migrations are idempotent', () => {
  const before = env.db.raw
    .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
    .all()
  runMigrations(env.db)
  runMigrations(env.db)
  const after = env.db.raw
    .query<{ version: string }, []>('SELECT version FROM schema_migrations ORDER BY version')
    .all()
  expect(after).toEqual(before)
  expect(after.length).toBeGreaterThan(0)
  expect(after[0]?.version).toBe('0001_init')
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

test('canonical current and immutable Team slots restrict Profile deletion', () => {
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

  const revisionFks = env.db.raw
    .query<{ table: string; from: string; on_delete: string }, []>(
      'SELECT "table", "from", on_delete FROM pragma_foreign_key_list(\'team_template_revision_slots\')',
    )
    .all()
  expect(
    revisionFks.find((f) => f.table === 'profiles' && f.from === 'profile_id')?.on_delete,
  ).toBe('RESTRICT')
})

test('foreign keys are enforced', () => {
  expect(() =>
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES ('a1', 'nope', 'x', 'idle', '/tmp/x', 'test-team', ?)`,
      [Date.now()],
    ),
  ).toThrow()
})

test('0003 adds telegram columns to agents/teams/profiles', () => {
  const agentCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
    .all()
    .map((r) => r.name)
  expect(agentCols).toContain('telegram_topic_id')
  expect(agentCols).toContain('telegram_topic_name_locked')
  expect(agentCols).toContain('telegram_icon_emoji')

  const groupCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('teams')")
    .all()
    .map((r) => r.name)
  expect(groupCols).toContain('telegram_icon_color')

  const profileCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('profiles')")
    .all()
    .map((r) => r.name)
  expect(profileCols).toContain('telegram_icon_emoji')

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
