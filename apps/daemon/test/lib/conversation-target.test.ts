import { randomUUID } from 'node:crypto'
import { unlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { createConversationFile } from '../../src/lib/conversation-file.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())

test('admission creates one initial conversation, then follows selection rather than mtime', () => {
  const first = resolveConversationTarget(env.db, env.paths, agentId)
  expect(resolveConversationTarget(env.db, env.paths, agentId)).toEqual(first)
  const next = conversations.create(
    env.db,
    agentId,
    {
      requestId: randomUUID(),
      expectedSelection: conversations.selection(env.db, agentId),
    },
    (id) => createConversationFile(env.paths, agentId, id, env.paths.teamDir(env.teamId)),
  )
  const future = new Date(Date.now() + 60_000)
  utimesSync(join(env.paths.agentDir(agentId), 'sessions', first.filename), future, future)
  expect(resolveConversationTarget(env.db, env.paths, agentId).id).toBe(next.conversation.id)
  expect(resolveConversationTarget(env.db, env.paths, agentId, first.id)).toEqual(first)
  expect(conversations.selection(env.db, agentId)).toEqual(next.selection)
})

test('missing selected files and foreign targets cannot silently create replacement conversations', () => {
  const first = resolveConversationTarget(env.db, env.paths, agentId)
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', first.filename))
  expect(() => resolveConversationTarget(env.db, env.paths, agentId)).toThrow()
  expect(() => resolveConversationTarget(env.db, env.paths, agentId, randomUUID())).toThrow()
  expect(conversations.list(env.db, agentId).total).toBe(1)
  expect(conversations.selection(env.db, agentId).conversationId).toBe(first.id)
})
