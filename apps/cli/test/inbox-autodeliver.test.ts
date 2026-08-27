// Integration test for scheduler-driven inbox auto-delivery.
//
// Exercises the end-to-end flow: a message is inserted into agent B's inbox
// (via the `/api/agents/:id/messages` POST, same path the CLI's `bazilion
// send` uses), the scheduler tick should drain B's unread mail within one
// tick interval and fire a turn for B with the messages embedded in the
// prompt. This fixture deliberately uses a configured-only local model so it
// proves the new protected preflight happens before provider use or inbox
// consumption. Successful protected dispatch is covered by the focused
// scheduler/runtime suites with closed OpenAI Codex and Docker fixtures.

import { createServer, type ServerResponse } from 'node:http'
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

function startMock(): Promise<MockLlm> {
  const queue: unknown[] = []
  let calls = 0
  const server = createServer((_req, res) => {
    calls++
    const item = queue.shift() ?? {
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }
    writeSse(res, item as Canned)
  })
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('unexpected address')
      resolve({
        url: `http://localhost:${addr.port}/v1`,
        push(items) {
          queue.push(...items)
        },
        reset() {
          queue.length = 0
          calls = 0
        },
        stop: () => new Promise((r) => server.close(() => r())),
        callCount() {
          return calls
        },
      })
    })
  })
}

let mock: MockLlm
let server: TestServer

beforeAll(async () => {
  mock = await startMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    // Fast scheduler ticks so the test doesn't wait 5s per auto-deliver.
    BAZILION_SCHEDULER_TICK_MS: '200',
  })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
})
beforeEach(() => {
  server.reset()
  mock.reset()
})

async function spawnAgent(name: string): Promise<string> {
  const r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', name])
  return extractAgentId(r.stdout)
}

test('protected readiness fails before a configured-only inbox message is marked read', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
  const a = await spawnAgent('alice')
  const b = await spawnAgent('bob')

  // Post a message from A to B through the HTTP API (same code path `bazilion
  // send` uses).
  const send = await server.cli(['send', a, b, 'hello bob, please reply'])
  expect(send.exitCode).toBe(0)

  // Give the scheduler several chances to preflight. A configured-only model
  // must never reach its provider and the canonical message must stay unread.
  await new Promise((r) => setTimeout(r, 1_000))
  expect(mock.callCount()).toBe(0)
  const unread = await server.cli(['inbox', 'list', b, '--unread'])
  expect(unread.exitCode).toBe(0)
  expect(unread.stdout).toContain('NEW')
  expect(unread.stdout).toContain('hello bob, please reply')
})
