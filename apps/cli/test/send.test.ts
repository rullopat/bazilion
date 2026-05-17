import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('send writes a message between two agents', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])

  let r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const a = extractAgentId(r.stdout)
  r = await server.cli(['agent', 'spawn', '--profile', 'p'])
  const b = extractAgentId(r.stdout)

  r = await server.cli(['send', a, b, 'hello there'])
  expect(r.exitCode).toBe(0)
  expect(r.stdout).toContain('sent message')
})

test('send fails when an agent is missing', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const r = await server.cli(['send', 'nope1', 'nope2', 'hi'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('agent not found')
})
