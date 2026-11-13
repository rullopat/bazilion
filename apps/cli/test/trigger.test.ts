import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_BASH_SANDBOX: 'off',
    // Drive the scheduler fast so the test doesn't wait 5s per tick.
    BAZILION_SCHEDULER_TICK_MS: '200',
  })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
})
// Reset order matters: wipe DB (kills any active triggers) *before* zeroing
// the mock's call counter, so a tick mid-reset can't increment `calls` after
// we've cleared it. The scheduler has nothing to fire after the DB wipe.
beforeEach(() => {
  server.reset()
  mock.reset()
  // The scheduler may fire more turns than a test expects; answer every one of them.
  mock.setFallback({ choices: [{ message: { role: 'assistant', content: 'default-pong' } }] })
})

async function spawnAgent(): Promise<string> {
  await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
  const r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  return extractAgentId(r.stdout)
}

test('trigger add/list round-trip', async () => {
  const agentId = await spawnAgent()
  const add = await server.cli([
    'trigger',
    'add',
    agentId,
    '--every',
    '60',
    '--message',
    'tick',
    '--disabled',
  ])
  expect(add.exitCode).toBe(0)
  expect(add.stdout).toMatch(/every 60s\tdisabled/)

  const list = await server.cli(['trigger', 'list', agentId])
  expect(list.exitCode).toBe(0)
  expect(list.stdout).toMatch(/every 60s/)
  expect(list.stdout).toMatch(/last: \(never\)/)
})

test('trigger enable/disable toggles state', async () => {
  const agentId = await spawnAgent()
  const add = await server.cli([
    'trigger',
    'add',
    agentId,
    '--every',
    '60',
    '--message',
    'tick',
    '--disabled',
  ])
  const [id] = add.stdout.trim().split('\t') as [string]
  expect(id).toBeTruthy()

  await server.cli(['trigger', 'enable', id])
  let list = await server.cli(['trigger', 'list', agentId])
  expect(list.stdout).toMatch(/enabled/)

  await server.cli(['trigger', 'disable', id])
  list = await server.cli(['trigger', 'list', agentId])
  expect(list.stdout).toMatch(/disabled/)
})

test('trigger rm deletes the trigger', async () => {
  const agentId = await spawnAgent()
  const add = await server.cli([
    'trigger',
    'add',
    agentId,
    '--every',
    '60',
    '--message',
    'tick',
    '--disabled',
  ])
  const [id] = add.stdout.trim().split('\t') as [string]
  await server.cli(['trigger', 'rm', id])
  const list = await server.cli(['trigger', 'list', agentId])
  expect(list.stdout).toContain('(no triggers)')
})

test('interval trigger runs its Agent turn on the host when the sandbox is off', async () => {
  const agentId = await spawnAgent()

  // intervalSec=1 → first fire happens ~1s after creation, scheduler ticks every 200ms.
  const add = await server.cli([
    'trigger',
    'add',
    agentId,
    '--every',
    '1',
    '--message',
    'hello from cron',
  ])
  expect(add.exitCode).toBe(0)
  const [triggerId] = add.stdout.trim().split('\t') as [string]

  // Wait up to 15s for `last_fired_at` to flip from never to a timestamp —
  // the scheduler bumps it before it kicks the worker.
  let fired = false
  for (let i = 0; i < 150; i++) {
    const list = await server.cli(['trigger', 'list', agentId])
    if (!/last: \(never\)/.test(list.stdout)) {
      fired = true
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(fired).toBe(true)
  // Unattended turns follow BAZILION_BASH_SANDBOX like chat: no Docker is needed when it is off.
  let history = await server.cli(['trigger', 'history', triggerId])
  for (let i = 0; i < 150 && !history.stdout.includes('succeeded'); i++) {
    await new Promise((r) => setTimeout(r, 100))
    history = await server.cli(['trigger', 'history', triggerId])
  }
  expect(history.exitCode).toBe(0)
  expect(history.stdout).toContain('succeeded')
  expect(mock.callCount()).toBeGreaterThan(0)
})

test('cron trigger with invalid expression is rejected', async () => {
  const agentId = await spawnAgent()
  const r = await server.cli([
    'trigger',
    'add',
    agentId,
    '--cron',
    'not-a-cron',
    '--message',
    'nope',
  ])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/invalid cron/i)
})

test('trigger add rejects both --every and --cron', async () => {
  const agentId = await spawnAgent()
  const r = await server.cli([
    'trigger',
    'add',
    agentId,
    '--every',
    '60',
    '--cron',
    '* * * * *',
    '--message',
    'hi',
  ])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toMatch(/exactly one of --every/)
})
