import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer({ BAZILION_SCHEDULER: 'off' })
})
afterAll(() => server.stop())

test('an unconfigured bridge is a status on stdout with exit 1, not an error', async () => {
  const health = await server.cli(['telegram', 'health'])
  expect(health.exitCode).toBe(1)
  expect(health.stdout).toContain('not configured — run `bazilion telegram config set` first')
  expect(health.stderr).toBe('')

  const bot = await server.cli(['telegram', 'bot', 'status'])
  expect(bot.exitCode).toBe(1)
  expect(bot.stdout).toContain('bot: not running')
})
