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

test('team add + list + rm (slug-only, real dir under teams/)', async () => {
  let r = await server.cli(['team', 'add', 'shared1'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('registered team shared1')

  // Real dir created at ~/.bazilion/teams/shared1/
  const slot = join(server.home, 'teams', 'shared1')
  expect(existsSync(slot)).toBe(true)
  expect(lstatSync(slot).isSymbolicLink()).toBe(false)
  expect(existsSync(join(slot, 'memory'))).toBe(true)

  r = await server.cli(['team', 'list'])
  expect(r.stdout).toContain('shared1')
  expect(r.stdout).toContain(slot)

  r = await server.cli(['team', 'rm', 'shared1'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['team', 'list'])
  // Auto-seeded 'default' team from the fixture stays; only the removed one is gone.
  expect(r.stdout).not.toContain('shared1')
  expect(r.stdout).toContain('default')
})

test('team add --link materializes the slot as a symlink', async () => {
  const target = mkdtempSync(join(tmpdir(), 'bazilion-cli-link-'))
  const r = await server.cli(['team', 'add', 'linked', '--link', target])
  expect(r.exitCode).toBe(0)
  const slot = join(server.home, 'teams', 'linked')
  expect(lstatSync(slot).isSymbolicLink()).toBe(true)
})

test('team add --link fails when target does not exist', async () => {
  const r = await server.cli([
    'team',
    'add',
    'ghost',
    '--link',
    '/tmp/bazilion-test-no-such-path-xyz',
  ])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('does not exist')
})

test('team user-md set + show + clear round-trip', async () => {
  let r = await server.cli(['team', 'user-md', 'show', 'default'])
  expect(r.exitCode).toBe(0)
  // The default team ships with the starter USER.md seeded.
  expect(r.stdout).toContain('About Your Human')

  r = await server.cli(['team', 'user-md', 'set', 'default', '--text', 'call me Pat'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['team', 'user-md', 'show', 'default'])
  expect(r.stdout).toContain('call me Pat')

  r = await server.cli(['team', 'user-md', 'clear', 'default'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['team', 'user-md', 'show', 'default'])
  expect(r.stdout.trim()).toBe('')
})
