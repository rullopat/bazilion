import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResultListResponse, UserQueueListResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import * as results from '../../daemon/src/core/repos/results.ts'
import { type MockLlm, reply, startLmStudioMock, toolCall } from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let mock: MockLlm
let server: TestServer
beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({ LMSTUDIO_URL: mock.url, BAZILION_SCHEDULER: 'off' })
}, 60_000)
afterAll(async () => {
  await server?.stop()
  await mock?.stop()
})

test('CLI lists, inspects, downloads without overwrite, and deletes saved results', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let id: string
  try {
    createProfile(db, paths, { id: 'producer', defaultModel: 'lmstudio:test-model' })
    const agent = spawnAgent(db, paths, { profileId: 'producer' })
    id = results.publish(db, {
      teamId: 'default',
      agentId: agent.id,
      sessionId: 'session',
      toolCallId: 'call',
      name: 'report.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('captured result'),
    }).id
  } finally {
    db.close()
  }
  let command = await server.cli(['result', 'list', '--team', 'default', '--json'])
  expect(command.exitCode).toBe(0)
  expect(command.stdout).toContain(id)
  command = await server.cli(['result', 'show', id])
  expect(command.stdout).toContain('sha256')
  const target = join(server.home, 'download.txt')
  command = await server.cli(['result', 'download', id, '--output', target])
  expect(command.exitCode).toBe(0)
  expect(readFileSync(target, 'utf8')).toBe('captured result')
  writeFileSync(target, 'operator edit')
  command = await server.cli(['result', 'download', id, '--output', target])
  expect(command.exitCode).not.toBe(0)
  expect(readFileSync(target, 'utf8')).toBe('operator edit')
  expect((await server.cli(['result', 'rm', id])).exitCode).not.toBe(0)
  expect((await server.cli(['result', 'rm', id, '--yes'])).exitCode).toBe(0)
  const absent = join(server.home, 'deleted.txt')
  expect((await server.cli(['result', 'download', id, '--output', absent])).exitCode).not.toBe(0)
  expect(existsSync(absent)).toBe(false)
})

// A queued follow-up turn has no chat stream. Its delivered file must still be a saved
// Result once the turn ends, exactly like a file delivered in a foreground chat.
test('a file delivered by a queued follow-up stays in Results after the turn', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let agentId: string
  try {
    createProfile(db, paths, { id: 'queued-producer', defaultModel: 'lmstudio:test-model' })
    agentId = spawnAgent(db, paths, { profileId: 'queued-producer' }).id
  } finally {
    db.close()
  }
  writeFileSync(join(paths.teamDir('default'), 'queued-report.md'), '# Queued report\n')
  mock.push([toolCall('deliver_file', { path: 'queued-report.md' }), reply('DELIVERED')])
  const queued = await server.cli([
    'queue',
    'add',
    agentId,
    '--message',
    'Deliver the queued report.',
  ])
  expect(queued.exitCode, queued.stderr).toBe(0)
  const itemId = (JSON.parse(queued.stdout) as { id: string }).id
  await vi.waitFor(
    async () => {
      const listed = await server.cli(['queue', 'list', agentId])
      const { items } = JSON.parse(listed.stdout) as UserQueueListResponse
      // A follow-up that ran leaves the list; a failed one would stay, with its reason.
      expect(items.find((item) => item.id === itemId)).toBeUndefined()
    },
    { timeout: 60_000, interval: 250 },
  )
  const listed = await server.cli(['result', 'list', '--agent', agentId, '--json'])
  expect(listed.exitCode).toBe(0)
  const saved = (JSON.parse(listed.stdout) as ResultListResponse).results
  expect(saved.map((result) => result.name)).toEqual(['queued-report.md'])
  const [result] = saved
  if (!result) throw new Error('Missing saved result')
  const target = join(server.home, 'queued-download.md')
  expect((await server.cli(['result', 'download', result.id, '--output', target])).exitCode).toBe(0)
  expect(readFileSync(target, 'utf8')).toBe('# Queued report\n')
}, 90_000)
