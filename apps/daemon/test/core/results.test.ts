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

describe('saved results', () => {
  test('a saved result keeps its original bytes; the same tool call returns it again', () => {
    const saved = results.publish(env.db, input)
    input.bytes.fill(0)
    expect(results.list(env.db).results.map((result) => result.id)).toEqual([saved.id])
    expect(results.read(env.db, saved.id).toString()).toBe('Original report')
    expect(results.get(env.db, saved.id)).toMatchObject({
      sha256: createHash('sha256').update('Original report').digest('hex'),
      sourceIndex: 0,
      imageModel: null,
    })
    expect(results.publish(env.db, input).id).toBe(saved.id)
    const second = results.publish(env.db, { ...input, toolCallId: 'call_fixture|fc_fixture' })
    expect(second.id).not.toBe(saved.id)
    expect(results.list(env.db, { teamId: env.teamId, limit: 1 }).total).toBe(2)
    expect(results.list(env.db, { agentId: 'other' }).results).toEqual([])
    expect(results.list(env.db, { offset: 1 }).results).toHaveLength(1)
  })

  test('refuses malformed tool calls, unsafe names and media types, and oversized files', () => {
    for (const id of ['call|', 'call||item', 'call/item', 'a'.repeat(257), 'call|item\n'])
      expect(() => results.publish(env.db, { ...input, toolCallId: id })).toThrow('tool call')
    for (const name of ['../secret', 'a\\b', 'a\r\nb', '.', ''])
      expect(() => results.publish(env.db, { ...input, name })).toThrow('filename')
    expect(() => results.publish(env.db, { ...input, mimeType: 'text/html\r\nX: evil' })).toThrow(
      'media',
    )
    expect(() =>
      results.publish(env.db, { ...input, bytes: Buffer.alloc(results.MAX_RESULT_BYTES + 1) }),
    ).toThrow('25 MiB')
  })

  test('deleting removes the file for good', () => {
    const saved = results.publish(env.db, input)
    expect(results.remove(env.db, 'missing')).toBe(false)
    expect(results.remove(env.db, saved.id)).toBe(true)
    expect(results.get(env.db, saved.id)).toBeNull()
    expect(results.list(env.db).total).toBe(0)
    expect(() => results.read(env.db, saved.id)).toThrow('not found')
  })

  test('an online backup keeps the saved bytes and who saved them', async () => {
    const saved = results.publish(env.db, input)
    const path = join(env.home, 'snapshot.db')
    await env.db.backupTo(path)
    results.remove(env.db, saved.id)
    const restored = openDb(path)
    try {
      expect(results.read(restored, saved.id).toString()).toBe('Original report')
      expect(results.get(restored, saved.id)).toMatchObject({
        teamId: env.teamId,
        agentId: input.agentId,
      })
    } finally {
      restored.close()
    }
  })

  test('detects corrupted stored content before download', () => {
    const saved = results.publish(env.db, input)
    env.db.raw.run('UPDATE agent_results SET bytes = ? WHERE id = ?', [
      Buffer.alloc(input.bytes.byteLength),
      saved.id,
    ])
    expect(() => results.read(env.db, saved.id)).toThrow('integrity')
  })

  test('a result outlives its Agent and goes with its Team', () => {
    const saved = results.publish(env.db, input)
    env.db.raw.run('DELETE FROM agents WHERE id = ?', [input.agentId])
    expect(results.get(env.db, saved.id)?.agentId).toBe(input.agentId)
    expect(results.read(env.db, saved.id).toString()).toBe('Original report')
    env.db.raw.run('DELETE FROM teams WHERE id = ?', [env.teamId])
    expect(results.get(env.db, saved.id)).toBeNull()
  })

  test('the 1 GiB store refuses new files but still returns already saved ones', () => {
    const saved = results.publish(env.db, input)
    const original = env.db.raw.query.bind(env.db.raw)
    // Simulate a full store without allocating 1 GiB in a unit test.
    vi.spyOn(env.db.raw, 'query').mockImplementation((sql: string) => {
      if (sql.includes('sum(byte_length)'))
        return {
          get: () => ({ bytes: results.MAX_RETAINED_RESULT_BYTES }),
          all: () => [],
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        } as ReturnType<typeof env.db.raw.query>
      return original(sql)
    })
    expect(results.publish(env.db, input).id).toBe(saved.id)
    expect(() => results.publish(env.db, { ...input, toolCallId: 'over-capacity' })).toThrow(
      'storage is full',
    )
    expect(original<{ n: number }, []>('SELECT count(*) AS n FROM agent_results').get()?.n).toBe(1)
  })
})
