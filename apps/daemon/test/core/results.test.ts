import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as results from '../../src/core/repos/results.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let input: results.PublishResultInput
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'result-producer', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'result-producer', teamId: env.teamId })
  input = {
    teamId: env.teamId,
    agentId: agent.id,
    sessionId: 'session-1',
    toolCallId: 'call-1',
    name: 'report.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('Original report'),
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  env.cleanup()
})

describe('durable result snapshots', () => {
  test('keeps publication private and releases the immutable original bytes', () => {
    const receipt = results.publish(env.db, input)
    input.bytes.fill(0)
    expect(results.getReleased(env.db, receipt.id)).toBeNull()
    expect(results.listReleased(env.db).results).toEqual([])
    expect(() => results.readReleased(env.db, receipt.id)).toThrow('not found')
    expect(() => results.release(env.db, receipt.id, 'other-agent')).toThrow('unavailable')
    results.release(env.db, receipt.id, input.agentId)
    expect(results.readReleased(env.db, receipt.id).toString()).toBe('Original report')
    expect(results.getReleased(env.db, receipt.id)?.sha256).toBe(
      createHash('sha256').update('Original report').digest('hex'),
    )
  })

  test('retries the same operation but does not overwrite a snapshot or merge filenames', () => {
    const first = results.publish(env.db, input)
    expect(results.publish(env.db, input).id).toBe(first.id)
    expect(() => results.publish(env.db, { ...input, bytes: Buffer.from('Changed') })).toThrow(
      'retry',
    )
    const second = results.publish(env.db, { ...input, toolCallId: 'call-2' })
    expect(second.id).not.toBe(first.id)
    results.release(env.db, first.id, input.agentId)
    results.release(env.db, second.id, input.agentId)
    expect(results.listReleased(env.db, { teamId: env.teamId, limit: 1 }).total).toBe(2)
    expect(results.listReleased(env.db, { agentId: 'other' }).results).toEqual([])
    expect(results.listReleased(env.db, { offset: 1 }).results).toHaveLength(1)
  })

  test('rolls back a failed publication without a dangling receipt', () => {
    env.db.raw.exec(`CREATE TRIGGER fail_result AFTER INSERT ON agent_results
      BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END`)
    expect(() => results.publish(env.db, input)).toThrow('simulated disk failure')
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM agent_results').get()?.n,
    ).toBe(0)
    env.db.raw.exec('DROP TRIGGER fail_result')
    expect(results.publish(env.db, input).id).toBeTruthy()
  })

  test('rejects spoofed producers, unsafe names, and oversized bytes', () => {
    expect(() => results.publish(env.db, { ...input, agentId: 'other' })).toThrow('member')
    for (const name of ['../secret', 'a\\b', 'a\r\nb', '.', '']) {
      expect(() => results.publish(env.db, { ...input, name })).toThrow('filename')
    }
    expect(() => results.publish(env.db, { ...input, mimeType: 'text/html\r\nX: evil' })).toThrow(
      'media',
    )
    expect(() =>
      results.publish(env.db, { ...input, bytes: Buffer.alloc(results.MAX_RESULT_BYTES + 1) }),
    ).toThrow('25 MiB')
  })

  test('deletion retains a truthful receipt and cannot be undone by retry or release', () => {
    const first = results.publish(env.db, input)
    expect(results.deleteReleased(env.db, first.id)).toBe(false)
    results.release(env.db, first.id, input.agentId)
    expect(results.deleteReleased(env.db, first.id)).toBe(true)
    expect(results.deleteReleased(env.db, first.id)).toBe(true)
    expect(results.getReleased(env.db, first.id)?.deletedAt).toBeTypeOf('number')
    expect(results.listReleased(env.db).total).toBe(0)
    expect(() => results.readReleased(env.db, first.id)).toThrow('unavailable')
    expect(() => results.release(env.db, first.id, input.agentId)).toThrow('unavailable')
    expect(() => results.publish(env.db, input)).toThrow('deleted')
  })

  test('online backup retains exact captured bytes, provenance and tombstones after reopen', async () => {
    const first = results.publish(env.db, input)
    results.release(env.db, first.id, input.agentId)
    const deleted = results.publish(env.db, { ...input, toolCallId: 'deleted' })
    results.release(env.db, deleted.id, input.agentId)
    results.deleteReleased(env.db, deleted.id)
    const path = join(env.home, 'snapshot.db')
    await env.db.backupTo(path)
    results.deleteReleased(env.db, first.id)
    const restored = openDb(path)
    try {
      expect(results.readReleased(restored, first.id).toString()).toBe('Original report')
      expect(results.getReleased(restored, first.id)).toMatchObject({
        teamId: env.teamId,
        agentId: input.agentId,
      })
      expect(results.getReleased(restored, deleted.id)?.deletedAt).toBeTypeOf('number')
    } finally {
      restored.close()
    }
  })

  test('detects corrupted stored content before download', () => {
    const first = results.publish(env.db, input)
    results.release(env.db, first.id, input.agentId)
    env.db.raw.run('UPDATE agent_results SET bytes = ? WHERE id = ?', [
      Buffer.alloc(input.bytes.byteLength),
      first.id,
    ])
    expect(() => results.readReleased(env.db, first.id)).toThrow('integrity')
  })
  test('retains producing identity after Agent deletion and removes results with the Team', () => {
    const first = results.publish(env.db, input)
    results.release(env.db, first.id, input.agentId)
    env.db.raw.run('DELETE FROM agents WHERE id = ?', [input.agentId])
    expect(results.getReleased(env.db, first.id)?.agentId).toBe(input.agentId)
    expect(results.readReleased(env.db, first.id).toString()).toBe('Original report')
    env.db.raw.run('DELETE FROM teams WHERE id = ?', [env.teamId])
    expect(results.getReceipt(env.db, first.id)).toBeNull()
  })

  test('counts private snapshots against capacity and permits idempotent retry at capacity', () => {
    const first = results.publish(env.db, input)
    const original = env.db.raw.query.bind(env.db.raw)
    // Simulate an already full store without allocating 1 GiB in a unit test. The
    // capacity query and INSERT still run through the production transaction path.
    vi.spyOn(env.db.raw, 'query').mockImplementation((sql: string) => {
      if (sql.includes('sum(byte_length)'))
        return {
          get: () => ({ bytes: results.MAX_RETAINED_RESULT_BYTES }),
          all: () => [],
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        } as ReturnType<typeof env.db.raw.query>
      return original(sql)
    })
    expect(results.publish(env.db, input).id).toBe(first.id)
    expect(() => results.publish(env.db, { ...input, toolCallId: 'over-capacity' })).toThrow(
      'storage is full',
    )
    expect(original<{ n: number }, []>('SELECT count(*) AS n FROM agent_results').get()?.n).toBe(1)
  })
})
