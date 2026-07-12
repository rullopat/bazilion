import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as teamRepo from '../../src/core/repos/teams.ts'
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

test('get returns the seeded starter content + a stable etag on a fresh team', async () => {
  // Fresh teams are seeded with DEFAULT_USER_MD, not ''.
  const host = createDbUserMdHost(env.db, env.paths)
  const r = await host.get(env.teamId)
  expect(r.content).toContain('About Your Human')
  expect(r.etag).toBe(etag(r.content))
})

test('write persists through teamRepo and returns the new etag', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { etag: ifMatch } = await host.get(env.teamId)
  const { etag: newEtag, totalBytes } = await host.write(env.teamId, 'first entry', ifMatch)
  expect(totalBytes).toBe(Buffer.byteLength('first entry', 'utf8'))
  expect(newEtag).toBe(etag('first entry'))
  expect(teamRepo.get(env.db, env.teamId, env.paths)?.userMd).toBe('first entry')
})

test('write fails (etag mismatch) when content moved on between get and write', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { etag: staleEtag } = await host.get(env.teamId) // = etag('')
  // Another caller writes first.
  await host.write(env.teamId, 'someone else got here', staleEtag)
  // Original caller tries to write with the now-stale etag — daemon impl
  // throws synchronously; the interface allows either sync or async.
  expect(() => host.write(env.teamId, 'my version', staleEtag)).toThrow(/etag mismatch/i)
  expect(teamRepo.get(env.db, env.teamId, env.paths)?.userMd).toBe('someone else got here')
})

test('write enforces the byte cap (does not persist on overflow)', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  const { content: before, etag: ifMatch } = await host.get(env.teamId)
  const big = 'x'.repeat(USER_MD_MAX_BYTES + 1)
  expect(() => host.write(env.teamId, big, ifMatch)).toThrow(/cap/i)
  // The failed write must leave the prior (seeded) content intact.
  expect(teamRepo.get(env.db, env.teamId, env.paths)?.userMd).toBe(before)
})

test('throws on unknown teamId', () => {
  const host = createDbUserMdHost(env.db, env.paths)
  expect(() => host.get('does-not-exist')).toThrow(/team not found/)
  expect(() => host.write('does-not-exist', 'x', 'anything')).toThrow(/team not found/)
})

test('write replaces (not appends) — full overwrite is the contract', async () => {
  const host = createDbUserMdHost(env.db, env.paths)
  let cur = await host.get(env.teamId)
  const r1 = await host.write(env.teamId, 'A', cur.etag)
  cur = { content: 'A', etag: r1.etag }
  await host.write(env.teamId, 'B', cur.etag)
  expect(teamRepo.get(env.db, env.teamId, env.paths)?.userMd).toBe('B')
})
