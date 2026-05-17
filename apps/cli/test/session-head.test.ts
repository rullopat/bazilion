import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ BAZILION_SCHEDULER: 'off' })
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('agent session-head reports (no session yet) for a fresh agent', async () => {
  let r = await server.cli(['profile', 'create', 'p', '--model', 'anthropic:claude-opus-4-6'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'A'])
  expect(r.exitCode).toBe(0)
  const agentId = extractAgentId(r.stdout)

  r = await server.cli(['agent', 'session-head', agentId])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('(no session yet)')
})

test('agent session-head --json emits the SessionHeadResponse shape', async () => {
  let r = await server.cli(['profile', 'create', 'p', '--model', 'anthropic:claude-opus-4-6'])
  expect(r.exitCode).toBe(0)

  r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'A'])
  expect(r.exitCode).toBe(0)
  const agentId = extractAgentId(r.stdout)

  r = await server.cli(['agent', 'session-head', agentId, '--json'])
  expect(r.exitCode).toBe(0)
  const body = JSON.parse(r.stdout) as { file: string | null; size: number }
  expect(body).toEqual({ file: null, size: 0 })
})

test('agent session-head returns 404 for an unknown agent', async () => {
  // Prefix matching needs at least 4 chars; use one that could not resolve.
  const r = await server.cli(['agent', 'session-head', 'deadbeef-no-such-agent'])
  expect(r.exitCode).not.toBe(0)
  // ApiClientError prints "error: agent not found: …"
  expect(r.stderr + r.stdout).toMatch(/not found/i)
})
