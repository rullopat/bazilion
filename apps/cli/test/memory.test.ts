import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

// The fixture seeds a `default` team on every reset — that's our scope.
const GROUP = 'default'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('memory write + read round-trip', async () => {
  let r = await server.cli(['memory', 'write', GROUP, 'colors.md', 'My favorite color is blue.'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('wrote colors.md')

  r = await server.cli(['memory', 'read', GROUP, 'colors.md'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('My favorite color is blue')
})

test('memory search finds written entries', async () => {
  await server.cli(['memory', 'write', GROUP, 'a.md', 'I like pasta'])
  await server.cli(['memory', 'write', GROUP, 'b.md', 'I like pizza'])
  await server.cli(['memory', 'write', GROUP, 'c.md', 'I like cars'])

  const r = await server.cli(['memory', 'search', GROUP, 'pizza'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('b.md')
  expect(r.stdout).not.toContain('a.md')
})

test('memory list shows all entries', async () => {
  await server.cli(['memory', 'write', GROUP, 'one.md', 'one'])
  await server.cli(['memory', 'write', GROUP, 'two.md', 'two'])

  const r = await server.cli(['memory', 'list', GROUP])
  expect(r.stdout).toContain('one.md')
  expect(r.stdout).toContain('two.md')
})

test('memory rm deletes the entry', async () => {
  await server.cli(['memory', 'write', GROUP, 'tmp.md', 'temporary'])
  await server.cli(['memory', 'rm', GROUP, 'tmp.md'])
  const r = await server.cli(['memory', 'read', GROUP, 'tmp.md'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('not found')
})

test('memory persists across CLI invocations under the team dir', async () => {
  await server.cli(['memory', 'write', GROUP, 'persist.md', 'survives restart'])
  // New CLI invocation = new subprocess; state lives server-side.
  const r = await server.cli(['memory', 'read', GROUP, 'persist.md'])
  expect(r.stdout).toContain('survives restart')
})

test('memory is shared across every agent in the team', async () => {
  // Spawn two agents both implicitly placed in `default`. They must see
  // the same entry — the whole point of moving memory to the team level.
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  await server.cli(['agent', 'spawn', '--profile', 'p'])
  await server.cli(['agent', 'spawn', '--profile', 'p'])

  await server.cli(['memory', 'write', GROUP, 'shared.md', 'visible to all'])
  const r = await server.cli(['memory', 'read', GROUP, 'shared.md'])
  expect(r.stdout).toContain('visible to all')
})
