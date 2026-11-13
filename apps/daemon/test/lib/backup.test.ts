import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { type SchemaObject, schemaMatches } from '../../src/core/db/schema.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as results from '../../src/core/repos/results.ts'
import { createBackupSnapshot } from '../../src/lib/backup.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})

test('a snapshot that cannot start does not hold up the backups after it', async () => {
  vi.stubEnv('TMPDIR', join(env.home, 'missing'))
  await expect(createBackupSnapshot(env.db)).rejects.toThrow(/ENOENT/)
  vi.unstubAllEnvs()

  const snapshot = await createBackupSnapshot(env.db)
  expect(existsSync(snapshot.database)).toBe(true)
  snapshot.cleanup()
  expect(existsSync(snapshot.directory)).toBe(false)
})

test('the backup snapshot keeps result bytes as they were when it was taken', async () => {
  createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId })
  const resultId = results.publish(env.db, {
    teamId: env.teamId,
    agentId: agent.id,
    sessionId: 'session',
    toolCallId: 'call',
    name: 'report.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('immutable'),
  }).id
  const snapshot = await createBackupSnapshot(env.db)
  try {
    results.remove(env.db, resultId)
    const restored = new DatabaseSync(snapshot.database, { readOnly: true })
    try {
      expect(schemaMatches((query) => restored.prepare(query).all() as SchemaObject[])).toBe(true)
      const row = restored.prepare('SELECT bytes FROM agent_results WHERE id = ?').get(resultId)
      expect(Buffer.from(row?.bytes as Uint8Array).toString()).toBe('immutable')
    } finally {
      restored.close()
    }
  } finally {
    snapshot.cleanup()
  }
})
