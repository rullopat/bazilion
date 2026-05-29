import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { DEFAULT_USER_MD } from '../../src/core/profile/templates.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

// The migration runs once during makeTestEnv; we re-exec its SQL directly to
// drive the backfill against rows we control. The UPDATE is idempotent
// (WHERE user_md = ''), so re-running it is safe.
const migrationSql = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/core/db/migrations/0008_seed_user_md.sql',
  ),
  'utf8',
)

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

function userMdOf(id: string): string | undefined {
  return env.db.raw
    .query<{ user_md: string }, [string]>('SELECT user_md FROM groups WHERE id = ?')
    .get(id)?.user_md
}

test('0008 backfills an empty user_md and leaves curated content untouched', () => {
  // One group cleared to '' (the pre-migration default), one operator-curated.
  env.db.raw.run('UPDATE groups SET user_md = ? WHERE id = ?', ['', env.groupId])
  env.db.raw.run('INSERT INTO groups (id, name, user_md, created_at) VALUES (?, ?, ?, ?)', [
    'curated',
    'Curated',
    'operator wrote this — keep it',
    Date.now(),
  ])

  env.db.raw.exec(migrationSql)

  expect(userMdOf(env.groupId)).toContain('About Your Human')
  expect(userMdOf('curated')).toBe('operator wrote this — keep it')
})

test('the backfilled content stays byte-identical to DEFAULT_USER_MD (drift guard)', () => {
  // SQL can't import the constant, so the literal is duplicated. This catches
  // the two copies silently diverging.
  env.db.raw.run('UPDATE groups SET user_md = ? WHERE id = ?', ['', env.groupId])
  env.db.raw.exec(migrationSql)
  expect(userMdOf(env.groupId)).toBe(DEFAULT_USER_MD)
})
