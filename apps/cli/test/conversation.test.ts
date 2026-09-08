import { randomUUID } from 'node:crypto'
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
test('CLI creates and renames retained history without changing active selection on reads', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'conversation-test', defaultModel: 'lmstudio:test' })
    agentId = spawnAgent(db, paths, { profileId: 'conversation-test', teamId: 'default' }).id
  } finally {
    db.close()
  }
  const requestId = randomUUID()
  const first = await server.cli([
    'conversation',
    'new',
    agentId,
    '--request-id',
    requestId,
    '--expected-revision',
    '0',
    '--expected-conversation',
    'none',
    '--title',
    'First task',
    '--json',
  ])
  expect(first.exitCode).toBe(0)
  const firstId = JSON.parse(first.stdout).conversation.id
  const second = await server.cli(['conversation', 'new', agentId, '--json'])
  expect(second.exitCode).toBe(0)
  const secondId = JSON.parse(second.stdout).conversation.id
  expect(
    (await server.cli(['conversation', 'rename', agentId, firstId, 'Original task'])).exitCode,
  ).toBe(0)
  const retry = await server.cli([
    'conversation',
    'new',
    agentId,
    '--request-id',
    requestId,
    '--expected-revision',
    '0',
    '--expected-conversation',
    'none',
    '--title',
    'First task',
    '--json',
  ])
  expect(retry.exitCode).toBe(0)
  expect(JSON.parse(retry.stdout)).toMatchObject({
    conversation: { id: firstId, title: 'Original task' },
    selection: { conversationId: secondId, revision: 2 },
  })
  const history = await server.cli(['conversation', 'show', agentId, firstId, '--json'])
  expect(history.exitCode).toBe(0)
  expect(JSON.parse(history.stdout)).toMatchObject({
    conversation: { title: 'Original task' },
    messages: [],
    selection: { conversationId: secondId },
  })
  const listed = await server.cli(['conversation', 'list', agentId, '--json'])
  expect(JSON.parse(listed.stdout)).toMatchObject({
    total: 2,
    selection: { conversationId: secondId, revision: 2 },
  })
})
