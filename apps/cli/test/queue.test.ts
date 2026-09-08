import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server?.stop())
test('CLI retains exact retries and controls paused input with revision checks', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'queue-cli', defaultModel: 'lmstudio:test' })
    agentId = spawnAgent(db, paths, { profileId: 'queue-cli', teamId: 'default' }).id
  } finally {
    db.close()
  }
  const paused = await server.cli(['queue', 'pause', agentId, '--expected-revision', '0'])
  expect(paused.exitCode).toBe(0)
  expect(JSON.parse(paused.stdout)).toMatchObject({ paused: true, revision: 1 })
  const requestId = randomUUID()
  const file = join(server.home, 'queue-input.txt')
  writeFileSync(file, 'keep attachment')
  const command = [
    'queue',
    'add',
    agentId,
    '--message',
    'retain this',
    '--files',
    JSON.stringify([file]),
    '--request-id',
    requestId,
    '--expected-conversation',
    'none',
    '--expected-selection-revision',
    '0',
  ]
  const accepted = await server.cli(command)
  expect(accepted.exitCode).toBe(0)
  expect(JSON.parse(accepted.stdout)).toMatchObject({ id: requestId, status: 'pending' })
  const retry = await server.cli(command)
  expect(retry.exitCode).toBe(0)
  expect(JSON.parse(retry.stdout).id).toBe(requestId)
  const edited = await server.cli([
    'queue',
    'edit',
    agentId,
    requestId,
    '--message',
    'edited text',
    '--expected-revision',
    '1',
  ])
  expect(edited.exitCode).toBe(0)
  const replacement = JSON.parse(edited.stdout)
  expect(replacement).toMatchObject({
    text: 'edited text',
    attachments: [{ name: 'queue-input.txt', byteLength: 15 }],
  })
  const listed = await server.cli(['queue', 'list', agentId])
  expect(JSON.parse(listed.stdout)).toMatchObject({ total: 1, control: { paused: true } })
  const stale = await server.cli([
    'queue',
    'remove',
    agentId,
    replacement.id,
    '--expected-revision',
    '0',
  ])
  expect(stale.exitCode).not.toBe(0)
  const removed = await server.cli([
    'queue',
    'remove',
    agentId,
    replacement.id,
    '--expected-revision',
    '1',
  ])
  expect(removed.exitCode).toBe(0)
  expect(JSON.parse(removed.stdout).status).toBe('cancelled')
  expect((await server.cli(command)).exitCode).toBe(0)
  const resumed = await server.cli(['queue', 'resume', agentId, '--expected-revision', '1'])
  expect(resumed.exitCode).toBe(0)
  expect(JSON.parse(resumed.stdout)).toMatchObject({ paused: false, revision: 2 })
})
