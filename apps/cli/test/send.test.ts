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
  const first = r.stdout.match(/sent message ([\w-]+)/)?.[1] as string

  r = await server.cli(['send', b, a, 'got it', '--reply-to', first])
  expect(r.exitCode).toBe(0)
  const reply = r.stdout.match(/sent message ([\w-]+)/)?.[1] as string
  const show = await server.cli(['inbox', 'show', reply])
  expect(show.stdout).toContain(`reply_to:  ${first}`)
})

test('send fails when an agent is missing', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const r = await server.cli(['send', 'nope1', 'nope2', 'hi'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr + r.stdout).toContain('agent not found')
})

test('a name shared by several agents is reported as ambiguous', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const a = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'ann'])).stdout,
  )
  await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'ann'])
  const r = await server.cli(['send', a, 'ann', 'hi'])
  expect(r.exitCode).not.toBe(0)
  expect(r.stderr).toContain('agent name "ann" is ambiguous')
})
