import { randomUUID } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

interface MockLlm {
  url: string
  push(responses: unknown[]): void
  reset(): void
  stop(): Promise<void>
  callCount(): number
}

interface Canned {
  choices: Array<{
    message: { role?: string; content?: string | null }
    finish_reason?: string
  }>
}

function writeSse(res: ServerResponse, canned: Canned): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const msg = canned.choices[0]?.message ?? {}
  const finish = canned.choices[0]?.finish_reason ?? 'stop'
  res.write(
    `data: ${JSON.stringify({
      id: 'mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })}\n\n`,
  )
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    res.write(
      `data: ${JSON.stringify({
        id: 'mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: msg.content }, finish_reason: null }],
      })}\n\n`,
    )
  }
  res.write(
    `data: ${JSON.stringify({
      id: 'mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

function startLmStudioMock(): Promise<MockLlm> {
  const queue: unknown[] = []
  let calls = 0
  const server = createServer((_req, res) => {
    calls++
    if (queue.length === 0) {
      // Default response so we never block — the scheduler may fire more times
      // than the test pushed responses for, and we don't want to deadlock.
      writeSse(res, {
        choices: [
          { message: { role: 'assistant', content: 'default-pong' }, finish_reason: 'stop' },
        ],
      })
      return
    }
    const item = queue.shift() as Canned
    writeSse(res, item)
  })
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('unexpected server address')
      resolve({
        url: `http://localhost:${addr.port}/v1`,
        push(items) {
          queue.push(...items)
        },
        reset() {
          queue.length = 0
          calls = 0
        },
        stop: () => new Promise<void>((r) => server.close(() => r())),
        callCount: () => calls,
      })
    })
  })
}

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    // This fixture exercises missing Docker even on hosts with a working engine.
    DOCKER_HOST: `unix://${join(tmpdir(), randomUUID(), 'docker.sock')}`,
    DOCKER_CONTEXT: '',
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

test('configured-provider interval trigger materializes but fails closed without protected Docker', async () => {
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
  let history = await server.cli(['trigger', 'history', triggerId])
  for (let i = 0; i < 50 && !history.stdout.includes('retrying'); i++) {
    await new Promise((r) => setTimeout(r, 50))
    history = await server.cli(['trigger', 'history', triggerId])
  }
  expect(history.exitCode).toBe(0)
  expect(history.stdout).toContain('retrying')
  expect(history.stdout).toContain('attempts: 1')
  expect(history.stdout).toContain('Protected Docker runtime is unavailable.')
  expect(mock.callCount()).toBe(0)
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
