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
test('CLI adds, edits, lists and removes follow-ups, and pauses and resumes the queue', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'queue-cli', defaultModel: 'lmstudio:test' })
    agentId = spawnAgent(db, paths, { profileId: 'queue-cli', teamId: 'default' }).id
  } finally {
    db.close()
  }
  const run = async (args: string[]) => {
    const result = await server.cli(args)
    expect(result.exitCode, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  }
  // Paused first, so the pump does not run the follow-up while the test inspects it.
  expect(await run(['queue', 'pause', agentId])).toEqual({ paused: true })
  const file = join(server.home, 'queue-input.txt')
  writeFileSync(file, 'keep attachment')
  const item = await run(['queue', 'add', agentId, '--message', 'retain this', '--file', file])
  expect(item).toMatchObject({
    status: 'pending',
    text: 'retain this',
    attachments: [{ name: 'queue-input.txt', mimeType: 'text/plain', byteLength: 15 }],
  })
  expect(await run(['queue', 'edit', agentId, item.id, '--message', 'edited text'])).toMatchObject({
    text: 'edited text',
    attachments: [{ name: 'queue-input.txt' }],
  })
  expect(await run(['queue', 'list', agentId])).toMatchObject({
    paused: true,
    turnActive: false,
    items: [{ id: item.id, text: 'edited text' }],
  })
  expect((await run(['queue', 'remove', agentId, item.id])).id).toBe(item.id)
  expect(await run(['queue', 'list', agentId])).toEqual({
    paused: true,
    turnActive: false,
    items: [],
  })
  expect((await server.cli(['queue', 'remove', agentId, item.id])).exitCode).not.toBe(0)
  expect(await run(['queue', 'resume', agentId])).toEqual({ paused: false })
})
