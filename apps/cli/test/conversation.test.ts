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
test('CLI starts, renames, reads and lists conversations; reading never changes the active one', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'conversation-test', defaultModel: 'lmstudio:test' })
    agentId = spawnAgent(db, paths, { profileId: 'conversation-test', teamId: 'default' }).id
  } finally {
    db.close()
  }
  const run = async (args: string[]) => {
    const result = await server.cli(args)
    expect(result.exitCode, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  }
  const first = await run(['conversation', 'new', agentId, '--title', 'First task', '--json'])
  expect(first).toMatchObject({ title: 'First task' })
  const second = await run(['conversation', 'new', agentId, '--json'])
  expect(second).toMatchObject({ title: 'Conversation 2' })
  expect(
    await run(['conversation', 'rename', agentId, first.id, 'Original task', '--json']),
  ).toMatchObject({
    conversation: { id: first.id, title: 'Original task' },
  })
  expect(await run(['conversation', 'show', agentId, first.id, '--json'])).toMatchObject({
    conversation: { title: 'Original task' },
    messages: [],
  })
  expect(await run(['conversation', 'list', agentId, '--json'])).toMatchObject({
    total: 2,
    selectedId: second.id,
  })
})
