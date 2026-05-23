import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as groupRepo from '../../src/core/repos/groups.ts'
import { createDbUserMdHost, USER_MD_MAX_BYTES } from '../../src/lib/user-md-host.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

function etag(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => env.cleanup())

test('get returns empty content + a stable etag on a fresh group', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const r = await host.get(env.groupId)
  expect(r.content).toBe('')
  expect(r.etag).toBe(etag(''))
})

test('write persists through groupRepo and returns the new etag', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { etag: ifMatch } = await host.get(env.groupId)
  const { etag: newEtag, totalBytes } = await host.write(env.groupId, 'first entry', ifMatch)
  expect(totalBytes).toBe(Buffer.byteLength('first entry', 'utf8'))
  expect(newEtag).toBe(etag('first entry'))
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('first entry')
})

test('write fails (etag mismatch) when content moved on between get and write', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { etag: staleEtag } = await host.get(env.groupId) // = etag('')
  // Another caller writes first.
  await host.write(env.groupId, 'someone else got here', staleEtag)
  // Original caller tries to write with the now-stale etag — daemon impl
  // throws synchronously; the interface allows either sync or async.
  expect(() => host.write(env.groupId, 'my version', staleEtag)).toThrow(/etag mismatch/i)
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('someone else got here')
})

test('write enforces the byte cap (does not persist on overflow)', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { etag: ifMatch } = await host.get(env.groupId)
  const big = 'x'.repeat(USER_MD_MAX_BYTES + 1)
  expect(() => host.write(env.groupId, big, ifMatch)).toThrow(/cap/i)
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('')
})

test('throws on unknown groupId', () => {
  const host = createDbUserMdHost(env.db, env.paths)
  expect(() => host.get('does-not-exist')).toThrow(/group not found/)
  expect(() => host.write('does-not-exist', 'x', 'anything')).toThrow(/group not found/)
})

test('write replaces (not appends) — full overwrite is the contract', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  let cur = await host.get(env.groupId)
  const r1 = await host.write(env.groupId, 'A', cur.etag)
  cur = { content: 'A', etag: r1.etag }
  await host.write(env.groupId, 'B', cur.etag)
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('B')
})
