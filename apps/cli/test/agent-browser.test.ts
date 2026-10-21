import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ BAZILION_SCHEDULER: 'off' })
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

async function spawnAgent(): Promise<string> {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const result = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'Browser test'])
  expect(result.exitCode, result.stderr).toBe(0)
  return extractAgentId(result.stdout)
}

test('agent browser status emits safe structured status and does not launch', async () => {
  const id = await spawnAgent()
  const result = await server.cli(['agent', 'browser', 'status', id])
  expect(result.exitCode, result.stderr).toBe(0)
  const status = JSON.parse(result.stdout) as Record<string, unknown>
  expect(status).toMatchObject({
    agentId: id,
    enabled: true,
    state: 'stopped',
    profilePresent: false,
  })
  expect(result.stdout + result.stderr).not.toMatch(/cookie|cdp|profile-path|secret/i)
})

test('agent browser stop preserves the profile; reset refuses without --yes and succeeds with it', async () => {
  const id = await spawnAgent()
  const status = await server.cli(['agent', 'browser', 'status', id])
  expect(status.exitCode).toBe(0)

  const stop = await server.cli(['agent', 'browser', 'stop', id])
  expect(stop.exitCode, stop.stderr).toBe(0)
  expect(stop.stdout).toMatch(/profile preserved/)

  // CLI test invocations are noninteractive; destructive reset requires an
  // explicit --yes rather than guessing or writing locally.
  const refused = await server.cli(['agent', 'browser', 'reset', id])
  expect(refused.exitCode).not.toBe(0)
  expect(refused.stderr + refused.stdout).toMatch(/without --yes/)

  const reset = await server.cli(['agent', 'browser', 'reset', id, '--yes'])
  expect(reset.exitCode, reset.stderr).toBe(0)
  expect(reset.stdout).toMatch(/profile removed/)
})

test('browser control refusal exits nonzero and prints only sanitized API diagnostics', async () => {
  const result = await server.cli(['agent', 'browser', 'stop', 'missing-agent'])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toMatch(/browser stop failed/i)
  expect(result.stderr).not.toMatch(/cookie|cdp|profile-path|child stderr/i)
})
