import { existsSync, lstatSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('group add + list + rm (slug-only, real dir under groups/)', async () => {
  let r = await server.cli(['group', 'add', 'shared1'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('registered group shared1')

  // Real dir created at ~/.bazilion/groups/shared1/
  const slot = join(server.home, 'groups', 'shared1')
  expect(existsSync(slot)).toBe(true)
  expect(lstatSync(slot).isSymbolicLink()).toBe(false)
  expect(existsSync(join(slot, 'memory'))).toBe(true)

  r = await server.cli(['group', 'list'])
  expect(r.stdout).toContain('shared1')
  expect(r.stdout).toContain(slot)

  r = await server.cli(['group', 'rm', 'shared1'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['group', 'list'])
  // Auto-seeded 'default' group from the fixture stays; only the removed one is gone.
  expect(r.stdout).not.toContain('shared1')
  expect(r.stdout).toContain('default')
})

test('group add --link materializes the slot as a symlink', async () => {
  const target = mkdtempSync(join(tmpdir(), 'bazilion-cli-link-'))
  const r = await server.cli(['group', 'add', 'linked', '--link', target])
  expect(r.exitCode).toBe(0)
  const slot = join(server.home, 'groups', 'linked')
  expect(lstatSync(slot).isSymbolicLink()).toBe(true)
})

test('group add --link fails when target does not exist', async () => {
  const r = await server.cli([
    'group',
    'add',
    'ghost',
    '--link',
    '/tmp/bazilion-test-no-such-path-xyz',
  ])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('does not exist')
})

test('group user-md set + show + clear round-trip', async () => {
  let r = await server.cli(['group', 'user-md', 'show', 'default'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout.trim()).toBe('')

  r = await server.cli(['group', 'user-md', 'set', 'default', '--text', 'call me Pat'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['group', 'user-md', 'show', 'default'])
  expect(r.stdout).toContain('call me Pat')

  r = await server.cli(['group', 'user-md', 'clear', 'default'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['group', 'user-md', 'show', 'default'])
  expect(r.stdout.trim()).toBe('')
})
