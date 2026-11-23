import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())

test('an Agent added with a role starts knowing its job, without the first-run questions', async () => {
  await server.cli(['profile', 'create', 'p', '--model', 'm'])
  const asking = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'Asker'])).stdout,
  )
  const working = await server.cli([
    'agent',
    'spawn',
    '--profile',
    'p',
    '--name',
    'Lead Researcher',
    '--role',
    'Find leads in Krakow and hand them to the Sales Director.',
  ])
  expect(working.exitCode, working.stderr).toBe(0)
  const id = extractAgentId(working.stdout)
  const dir = join(server.home, 'agents', id)
  expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toMatch(
    /^# Your role\n\nFind leads in Krakow and hand them to the Sales Director\.\n\nThe operator added you to the Team Default/,
  )
  expect(existsSync(join(dir, 'BOOTSTRAP.md'))).toBe(false)
  // Without a role it asks who it is in its first conversation.
  expect(existsSync(join(server.home, 'agents', asking, 'BOOTSTRAP.md'))).toBe(true)
  // A name the Team already has is refused.
  const again = await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'lead researcher'])
  expect(again.exitCode).not.toBe(0)
  expect(again.stderr).toContain('already has an Agent named')
})

test('team today lists the hand-offs of the day', async () => {
  const from = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'Sally'])).stdout,
  )
  const to = extractAgentId(
    (await server.cli(['agent', 'spawn', '--profile', 'p', '--name', 'Reachy'])).stdout,
  )
  expect((await server.cli(['send', from, to, 'Find 20 leads in Krakow.'])).exitCode).toBe(0)
  const today = await server.cli(['team', 'today', 'default'])
  expect(today.exitCode, today.stderr).toBe(0)
  expect(today.stdout).toMatch(/Sally -> Reachy\s+handed off\s+Find 20 leads in Krakow\./)
})
