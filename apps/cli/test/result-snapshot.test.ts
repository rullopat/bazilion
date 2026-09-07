import { copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../daemon/src/core/agent/spawn.ts'
import { createProfile } from '../../daemon/src/core/profile/create.ts'
import * as results from '../../daemon/src/core/repos/results.ts'
import { createBackupSnapshot } from '../../daemon/src/lib/backup.ts'
import { makeTestEnv, type TestEnv } from '../../daemon/test/core/helpers.ts'
import { assertCanonicalBackupSchema } from '../src/backup-schema.ts'
import { makeHome, runCli } from './helpers.ts'

let env: TestEnv
let resultId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId })
  const result = results.publish(env.db, {
    teamId: env.teamId,
    agentId: agent.id,
    sessionId: 'session',
    toolCallId: 'call',
    name: 'report.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('immutable'),
  })
  results.release(env.db, result.id, agent.id)
  resultId = result.id
})
afterEach(() => env.cleanup())

test('the canonical snapshot contains result bytes and passes CLI restore validation', async () => {
  const snapshot = await createBackupSnapshot(env.db)
  try {
    results.deleteReleased(env.db, resultId)
    const restored = new DatabaseSync(snapshot.database)
    try {
      expect(() => assertCanonicalBackupSchema(restored)).not.toThrow()
      expect(
        Buffer.from(
          restored.prepare('SELECT bytes FROM agent_results WHERE id = ?').get(resultId)
            ?.bytes as Uint8Array,
        ).toString(),
      ).toBe('immutable')
      restored
        .prepare('UPDATE agent_results SET bytes = ? WHERE id = ?')
        .run(Buffer.from('corrupted'), resultId)
      expect(() => assertCanonicalBackupSchema(restored)).toThrow('Result snapshot integrity')
    } finally {
      restored.close()
    }
  } finally {
    snapshot.cleanup()
  }
})

test('backup fails explicitly when captured bytes do not match their manifest', async () => {
  env.db.raw.run('UPDATE agent_results SET bytes = ? WHERE id = ?', [
    Buffer.from('corrupted'),
    resultId,
  ])
  await expect(createBackupSnapshot(env.db)).rejects.toThrow('Result snapshot integrity')
})

test.each([
  false,
  true,
])('offline uninstall (full=%s) removes captured bytes with the DB and preserves linked sources', async (full) => {
  const snapshot = await createBackupSnapshot(env.db)
  const external = makeHome()
  try {
    copyFileSync(snapshot.database, env.paths.db)
    writeFileSync(env.paths.authFile, JSON.stringify({ token: 'isolated-uninstall-fixture' }))
    writeFileSync(join(external.home, 'report.txt'), 'external source')
    symlinkSync(external.home, env.paths.teamDir('linked-source'))
    const response = await runCli(['uninstall', '--yes', ...(full ? ['--all'] : [])], env.home)
    expect(response.exitCode, response.stderr).toBe(0)
    expect(existsSync(env.paths.db)).toBe(false)
    expect(existsSync(env.paths.authFile)).toBe(false)
    expect(existsSync(env.paths.teamsDir)).toBe(false)
    expect(readFileSync(join(external.home, 'report.txt'), 'utf8')).toBe('external source')
  } finally {
    external.cleanup()
    snapshot.cleanup()
  }
})
