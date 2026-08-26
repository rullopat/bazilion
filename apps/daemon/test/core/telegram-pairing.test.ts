import { afterEach, beforeEach, expect, test } from 'vitest'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import * as pairing from '../../src/core/repos/telegram-pairing.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('stores only a digest and consumes a challenge exactly once', () => {
  const challenge = pairing.create(env.db)
  const row = env.db.raw
    .query<{ digest: string }, []>('SELECT digest FROM telegram_pairing_challenge')
    .get()
  expect(row?.digest).not.toContain(challenge.code)
  expect(row?.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(pairing.consume(env.db, { code: 'wrong', userId: 1 })).toBe(false)
  expect(pairing.consume(env.db, { code: challenge.code, userId: 1 })).toBe(true)
  expect(pairing.consume(env.db, { code: challenge.code, userId: 2 })).toBe(false)
  expect(acl.get(env.db, 1)?.role).toBe('owner')
  expect(pairing.status(env.db).challengeActive).toBe(false)
})

test('expired challenges fail closed and are removed', () => {
  const challenge = pairing.create(env.db)
  env.db.raw.run('UPDATE telegram_pairing_challenge SET expires_at = 0')
  expect(pairing.consume(env.db, { code: challenge.code, userId: 1 })).toBe(false)
  expect(pairing.status(env.db).challengeActive).toBe(false)
})

test('reset atomically removes the owner and active challenge', () => {
  acl.add(env.db, { userId: 1, role: 'owner' })
  pairing.reset(env.db)
  pairing.create(env.db)
  pairing.reset(env.db)
  expect(acl.count(env.db)).toBe(0)
  expect(pairing.status(env.db)).toEqual({
    paired: false,
    challengeActive: false,
    challengeExpiresAt: null,
    ownerUserId: null,
  })
})
