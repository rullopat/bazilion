import { existsSync, lstatSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { registerGroup } from '../../src/core/group/register.ts'
import { DEFAULT_USER_MD } from '../../src/core/profile/templates.ts'
import * as groupRepo from '../../src/core/repos/groups.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('registerGroup creates a real directory under groups/<slug>/', () => {
  const g = registerGroup(env.db, { id: 'g1' }, env.paths)
  expect(g.id).toBe('g1')
  expect(g.path).toBe(env.paths.groupDir('g1'))
  // registerGroup seeds the starter USER.md (byte-identical to the
  // constant) by default, and it round-trips through the DB.
  expect(g.userMd).toBe(DEFAULT_USER_MD)
  expect(groupRepo.get(env.db, 'g1', env.paths)?.userMd).toBe(DEFAULT_USER_MD)
  expect(existsSync(g.path)).toBe(true)
  expect(lstatSync(g.path).isSymbolicLink()).toBe(false)
  expect(existsSync(join(g.path, 'memory'))).toBe(true)
  // +1 over the auto-seeded test-group from makeTestEnv.
  expect(groupRepo.list(env.db, env.paths).length).toBe(2)
})

test('registerGroup with --link materializes the slot as a symlink', () => {
  const target = mkdtempSync(join(tmpdir(), 'bazilion-link-'))
  const g = registerGroup(env.db, { id: 'linked', link: target }, env.paths)
  expect(g.path).toBe(env.paths.groupDir('linked'))
  expect(lstatSync(g.path).isSymbolicLink()).toBe(true)
  // memory subdir gets created via the symlink — ends up inside the target.
  expect(existsSync(join(target, 'memory'))).toBe(true)
})

test('registerGroup --link fails when target does not exist', () => {
  expect(() =>
    registerGroup(env.db, { id: 'broken', link: '/tmp/no-such-bazilion-target-x9' }, env.paths),
  ).toThrow(/does not exist/)
})

test('registerGroup refuses duplicate slug', () => {
  registerGroup(env.db, { id: 'first' }, env.paths)
  expect(() => registerGroup(env.db, { id: 'first' }, env.paths)).toThrow(/already registered/)
})

test('registerGroup refuses if the on-disk slot already exists', () => {
  // Materialize the slot before the registry call — should bail out cleanly.
  const slot = env.paths.groupDir('preexisting')
  symlinkSync(env.home, slot, 'dir')
  expect(() => registerGroup(env.db, { id: 'preexisting' }, env.paths)).toThrow(/slot already/)
})

test('registerGroup rejects invalid slug', () => {
  expect(() => registerGroup(env.db, { id: 'Bad Id' }, env.paths)).toThrow(/invalid slug/)
})

test('setUserMd updates the stored value, read back via get', () => {
  const g = registerGroup(env.db, { id: 'with-user-md' }, env.paths)
  groupRepo.setUserMd(env.db, g.id, 'hi, call me Pat')
  const reloaded = groupRepo.get(env.db, g.id, env.paths)
  expect(reloaded?.userMd).toBe('hi, call me Pat')
})
