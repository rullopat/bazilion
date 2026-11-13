// Integration test for scheduler-driven inbox auto-delivery.
//
// Exercises the end-to-end flow: a message is inserted into agent B's inbox
// (via the `/api/agents/:id/messages` POST, same path the CLI's `bazilion
// send` uses), the scheduler tick should drain B's unread mail within one
// tick interval and fire a turn for B with the messages embedded in the
// prompt. Inbox wakes follow BAZILION_BASH_SANDBOX like chat, so with the
// sandbox off the turn runs on the host and needs no Docker.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { type MockLlm, sseFromCanned, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm
let server: TestServer

const bodies: string[] = []

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_BASH_SANDBOX: 'off',
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
  bodies.length = 0
  mock.setFallback(async (req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    bodies.push(body)
    sseFromCanned(res, { choices: [{ message: { role: 'assistant', content: 'ok' } }] })
  })
})

async function spawnAgent(name: string): Promise<string> {
  const r = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', name])
  return extractAgentId(r.stdout)
}

test('the scheduler delivers inbox mail as a host turn when the sandbox is off', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
  const a = await spawnAgent('alice')
  const b = await spawnAgent('bob')

  // Post a message from A to B through the HTTP API (same code path `bazilion
  // send` uses).
  const send = await server.cli(['send', a, b, 'hello bob, please reply'])
  expect(send.exitCode).toBe(0)

  // The wake claims the message, then runs bob's turn with it in the prompt.
  let unread = ''
  for (const deadline = Date.now() + 20_000; Date.now() < deadline; ) {
    unread = (await server.cli(['inbox', 'list', b, '--unread'])).stdout
    if (!unread.includes('hello bob') && mock.callCount() > 0) break
    await new Promise((r) => setTimeout(r, 200))
  }
  expect(mock.callCount()).toBeGreaterThan(0)
  expect(bodies.some((body) => body.includes('hello bob, please reply'))).toBe(true)
  expect(unread).not.toContain('hello bob, please reply')
})
