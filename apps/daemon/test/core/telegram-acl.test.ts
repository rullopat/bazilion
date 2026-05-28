// Telegram allowlist repo: round-trip, upsert, and last-owner protection.

import { afterEach, beforeEach, expect, test } from 'vitest'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('add + get + isAllowed + count round-trip', () => {
  expect(acl.count(env.db)).toBe(0)
  expect(acl.isAllowed(env.db, 1)).toBe(false)

  const u = acl.add(env.db, { userId: 1, username: 'pat', label: 'Pat', role: 'owner' })
  expect(u.role).toBe('owner')
  expect(acl.isAllowed(env.db, 1)).toBe(true)
  expect(acl.count(env.db)).toBe(1)
  expect(acl.get(env.db, 1)?.username).toBe('pat')
})

test('add upserts username/label and keeps role', () => {
  acl.add(env.db, { userId: 1, username: 'old', role: 'owner' })
  acl.add(env.db, { userId: 1, username: 'new', label: 'New' })
  const u = acl.get(env.db, 1)
  expect(u?.username).toBe('new')
  expect(u?.label).toBe('New')
  expect(u?.role).toBe('owner') // role unchanged by upsert
})

test('remove refuses to delete the last owner, allows members', () => {
  acl.add(env.db, { userId: 1, role: 'owner' })
  acl.add(env.db, { userId: 2, role: 'member' })

  expect(acl.remove(env.db, 1)).toBe(false) // last owner protected
  expect(acl.isAllowed(env.db, 1)).toBe(true)

  expect(acl.remove(env.db, 2)).toBe(true) // member removable
  expect(acl.isAllowed(env.db, 2)).toBe(false)
})

test('remove allows an owner when another owner remains', () => {
  acl.add(env.db, { userId: 1, role: 'owner' })
  acl.add(env.db, { userId: 2, role: 'owner' })
  expect(acl.remove(env.db, 1)).toBe(true)
  expect(acl.ownerCount(env.db)).toBe(1)
})
