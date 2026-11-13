import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as queue from '../../src/core/repos/user-queue.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string
let conversationId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'queue', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'queue', teamId: env.teamId }).id
  conversationId = resolveConversationTarget(env.db, env.paths, agentId).id
})
afterEach(() => env.cleanup())
const notes = {
  name: 'notes.txt',
  mimeType: 'text/plain',
  data: Buffer.from('captured bytes').toString('base64'),
}
function input(overrides: Partial<queue.QueueInput> = {}): queue.QueueInput {
  return {
    agentId,
    conversationId,
    message: 'Use this exact input',
    attachments: [notes],
    ...overrides,
  }
}

test('items run oldest first with their exact bytes; a claim waits for the running item', () => {
  const first = queue.add(env.db, input())
  const second = queue.add(env.db, input({ message: 'second', attachments: [] }))
  expect(first).toMatchObject({
    status: 'pending',
    source: 'http',
    attachments: [{ name: 'notes.txt', mimeType: 'text/plain', byteLength: 14 }],
  })
  const claimed = queue.claim(env.db, agentId)
  expect(claimed?.item).toMatchObject({ id: first.id, status: 'running' })
  expect(claimed?.attachments).toEqual([notes])
  expect(queue.claim(env.db, agentId)).toBeNull()
  queue.finish(env.db, agentId, first.id, 'completed')
  expect(queue.claim(env.db, agentId)?.item.id).toBe(second.id)
  // An item whose turn could not start goes back to the head.
  queue.unclaim(env.db, second.id)
  expect(queue.claim(env.db, agentId)?.item.id).toBe(second.id)
})

test('a Telegram message is queued once and keeps its origin', () => {
  const origin = { chatId: -100, threadId: 7, messageId: 9, userId: 3 }
  const telegram = { key: '-100:9', origin }
  const item = queue.add(env.db, input({ telegram }))
  expect(queue.add(env.db, input({ telegram, message: 'redelivered' })).id).toBe(item.id)
  expect(item.source).toBe('telegram')
  expect(queue.telegramOrigin(env.db, item.id)).toEqual(origin)
  expect(queue.list(env.db, agentId).items).toHaveLength(1)
})

test('only waiting items can be edited; anything not running can be removed', () => {
  const item = queue.add(env.db, input())
  expect(queue.edit(env.db, agentId, item.id, 'corrected')).toMatchObject({
    text: 'corrected',
    attachments: [{ name: 'notes.txt' }],
  })
  // Text may be emptied while an attachment remains; an item with neither is refused.
  expect(queue.edit(env.db, agentId, item.id, '').attachments).toHaveLength(1)
  const textOnly = queue.add(env.db, input({ attachments: [] }))
  expect(() => queue.edit(env.db, agentId, textOnly.id, ' ')).toThrow(queue.QueueInputError)
  expect(queue.get(env.db, agentId, textOnly.id)?.text).toBe('Use this exact input')
  queue.remove(env.db, agentId, textOnly.id)
  queue.claim(env.db, agentId)
  expect(() => queue.edit(env.db, agentId, item.id, 'late')).toThrow(queue.QueueConflictError)
  expect(() => queue.remove(env.db, agentId, item.id)).toThrow(queue.QueueConflictError)
  queue.finish(env.db, agentId, item.id, 'failed', 'Provider unavailable')
  expect(queue.list(env.db, agentId).items).toMatchObject([
    { status: 'failed', diagnostic: 'Provider unavailable' },
  ])
  expect(queue.remove(env.db, agentId, item.id).item.id).toBe(item.id)
  expect(queue.list(env.db, agentId).items).toEqual([])
})

test('a paused queue starts nothing until resumed', () => {
  queue.add(env.db, input())
  queue.setPaused(env.db, agentId, true)
  expect(queue.claim(env.db, agentId)).toBeNull()
  expect(queue.agentsWithPending(env.db)).toEqual([])
  queue.setPaused(env.db, agentId, false)
  expect(queue.agentsWithPending(env.db)).toEqual([agentId])
  expect(queue.claim(env.db, agentId)).not.toBeNull()
})

test('input is validated and the per-Agent queue is bounded', () => {
  expect(() => queue.add(env.db, input({ message: '', attachments: [] }))).toThrow('empty')
  expect(() =>
    queue.add(env.db, input({ message: 'x'.repeat(queue.QUEUE_LIMITS.textBytes + 1) })),
  ).toThrow('64 KiB')
  expect(() =>
    queue.add(env.db, input({ attachments: [{ mimeType: 'not a type', data: '' }] })),
  ).toThrow('attachment')
  for (let index = 0; index < queue.QUEUE_LIMITS.perAgent; index++)
    queue.add(env.db, input({ attachments: [] }))
  expect(() => queue.add(env.db, input())).toThrow(queue.QueueCapacityError)
})

test('a restart fails the item that was running and pauses its queue; old items are pruned', () => {
  const running = queue.add(env.db, input())
  const waiting = queue.add(env.db, input())
  queue.claim(env.db, agentId)
  const file = join(env.home, 'queue-restart.db')
  env.db.raw.run('VACUUM INTO ?', [file])
  const reopened = openDb(file)
  try {
    expect(queue.recoverInterrupted(reopened)).toBe(1)
    expect(queue.get(reopened, agentId, running.id)).toMatchObject({
      status: 'failed',
      diagnostic: expect.stringContaining('restart'),
    })
    expect(queue.get(reopened, agentId, waiting.id)?.status).toBe('pending')
    expect(queue.isPaused(reopened, agentId)).toBe(true)
    expect(queue.claim(reopened, agentId)).toBeNull()
    expect(queue.prune(reopened, Date.now() + queue.QUEUE_LIMITS.keepMs + 1)).toBe(1)
    expect(queue.list(reopened, agentId).items.map((item) => item.id)).toEqual([waiting.id])
  } finally {
    reopened.close()
  }
})
