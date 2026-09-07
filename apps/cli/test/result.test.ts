import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import * as results from '../../daemon/src/core/repos/results.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server?.stop())
test('CLI lists, inspects, downloads without overwrite, and deletes saved results', async () => {
  const paths = resolvePaths(server.home)
  const db = openDb(paths.db)
  let id: string
  let privateId: string
  try {
    createProfile(db, paths, { id: 'producer', defaultModel: 'lmstudio:test-model' })
    const agent = spawnAgent(db, paths, { profileId: 'producer' })
    const input = {
      teamId: 'default',
      agentId: agent.id,
      sessionId: 'session',
      toolCallId: 'call',
      name: 'report.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('captured result'),
    }
    const result = results.publish(db, input)
    id = result.id
    privateId = results.publish(db, { ...input, toolCallId: 'held' }).id
    results.release(db, id, agent.id)
  } finally {
    db.close()
  }
  let command = await server.cli(['result', 'list', '--team', 'default', '--json'])
  expect(command.exitCode).toBe(0)
  expect(command.stdout).toContain(id)
  expect(command.stdout).not.toContain(privateId)
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
