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
    'groups',
    'messages',
    'profile_default_skills',
    'profiles',
    'schema_migrations',
  ]) {
    expect(tables).toContain(t)
  }
  // Junction tables dropped in 0005; runs + events dropped in 0003.
  expect(tables).not.toContain('agent_workspaces')
  expect(tables).not.toContain('profile_workspaces')
  expect(tables).not.toContain('workspaces')
  expect(tables).not.toContain('runs')
  expect(tables).not.toContain('events')
})

test('profiles table has skills_mode and no default_workspace_id', () => {
  const cols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('profiles')")
    .all()
    .map((r) => r.name)
  expect(cols).toContain('skills_mode')
  expect(cols).not.toContain('default_workspace_id')
})

test('agents table has group_id; groups table has user_md', () => {
  const agentCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
    .all()
    .map((r) => r.name)
  expect(agentCols).toContain('group_id')

  const groupCols = env.db.raw
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('groups')")
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

test('foreign keys are enforced', () => {
  expect(() =>
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, group_id, created_at)
       VALUES ('a1', 'nope', 'x', 'idle', '/tmp/x', 'test-group', ?)`,
      [Date.now()],
    ),
  ).toThrow()
})
