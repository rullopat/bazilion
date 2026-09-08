import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { createConversationFile } from '../../src/lib/conversation-file.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())
function persist(id: string) {
  return createConversationFile(env.paths, agentId, id, env.paths.teamDir(env.teamId))
}
function create() {
  return conversations.create(
    env.db,
    agentId,
    {
      requestId: randomUUID(),
      expectedSelection: conversations.selection(env.db, agentId),
    },
    persist,
  )
}

test('creation selects once and retries cannot redirect later selection', () => {
  const input = {
    requestId: randomUUID(),
    expectedSelection: { conversationId: null, revision: 0 },
  }
  const first = conversations.create(env.db, agentId, input, persist)
  expect(first.selection).toEqual({ conversationId: input.requestId, revision: 1 })
  const second = create()
  const retried = conversations.create(
    env.db,
    agentId,
    input,
    vi.fn(() => {
      throw new Error('must not write')
    }),
  )
  expect(retried.conversation.id).toBe(first.conversation.id)
  expect(retried.selection).toEqual(second.selection)
  expect(conversations.list(env.db, agentId).total).toBe(2)
  expect(() =>
    conversations.create(env.db, agentId, { ...input, title: 'Different' }, persist),
  ).toThrow('reused')
  expect(() =>
    conversations.create(
      env.db,
      agentId,
      { ...input, expectedSelection: { ...input.expectedSelection, conversationId: randomUUID() } },
      persist,
    ),
  ).toThrow('reused')
})

test('stale creation and failed durable publication cannot alter selection', () => {
  const first = create()
  const writer = vi.fn(persist)
  expect(() =>
    conversations.create(
      env.db,
      agentId,
      { requestId: randomUUID(), expectedSelection: { conversationId: null, revision: 0 } },
      writer,
    ),
  ).toThrow(conversations.ConversationConflictError)
  expect(writer).not.toHaveBeenCalled()
  expect(() =>
    conversations.create(
      env.db,
      agentId,
      { requestId: randomUUID(), expectedSelection: first.selection },
      () => {
        throw new Error('disk full')
      },
    ),
  ).toThrow('disk full')
  expect(conversations.selection(env.db, agentId)).toEqual(first.selection)
  expect(conversations.list(env.db, agentId).total).toBe(1)
})

test('renaming retained history is revision checked and never selects it', () => {
  const first = create()
  const second = create()
  expect(
    conversations.rename(env.db, agentId, first.conversation.id, 'Earlier task', 1),
  ).toMatchObject({ title: 'Earlier task', titleRevision: 2 })
  expect(() => conversations.rename(env.db, agentId, first.conversation.id, 'Stale', 1)).toThrow()
  expect(conversations.selection(env.db, agentId)).toEqual(second.selection)
  expect(conversations.get(env.db, agentId, first.conversation.id)?.title).toBe('Earlier task')
})

test('Agent boundaries, pagination and lifecycle are enforced by metadata', () => {
  const first = create()
  const other = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
  expect(conversations.get(env.db, other, first.conversation.id)).toBeNull()
  expect(() => conversations.filename(env.db, other, first.conversation.id)).toThrow()
  expect(() => conversations.rename(env.db, other, first.conversation.id, 'Foreign', 1)).toThrow()
  expect(() => conversations.list(env.db, agentId, 101)).toThrow()
  expect(() => conversations.list(env.db, agentId, 20, -1)).toThrow()
  env.db.raw.run('DELETE FROM agents WHERE id = ?', [agentId])
  expect(conversations.list(env.db, agentId).total).toBe(0)
  expect(conversations.selection(env.db, agentId)).toEqual({ conversationId: null, revision: 0 })
})
