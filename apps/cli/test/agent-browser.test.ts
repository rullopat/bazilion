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

test('agent browser status prints the status as JSON without starting a browser', async () => {
  const id = await spawnAgent()
  const result = await server.cli(['agent', 'browser', 'status', id])
  expect(result.exitCode, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({
    agentId: id,
    enabled: true,
    running: false,
    profilePresent: false,
  })
})

test('agent browser stop keeps the profile; reset needs --yes when not interactive', async () => {
  const id = await spawnAgent()
  const stop = await server.cli(['agent', 'browser', 'stop', id])
  expect(stop.exitCode, stop.stderr).toBe(0)
  expect(stop.stdout).toMatch(/profile kept/)

  const refused = await server.cli(['agent', 'browser', 'reset', id])
  expect(refused.exitCode).not.toBe(0)
  expect(refused.stderr + refused.stdout).toMatch(/without --yes/)

  const reset = await server.cli(['agent', 'browser', 'reset', id, '--yes'])
  expect(reset.exitCode, reset.stderr).toBe(0)
  expect(reset.stdout).toMatch(/profile removed/)
})

test('a browser command for an unknown agent fails with the daemon error', async () => {
  const result = await server.cli(['agent', 'browser', 'stop', 'missing-agent'])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toMatch(/error: agent not found: missing-agent/)
})
