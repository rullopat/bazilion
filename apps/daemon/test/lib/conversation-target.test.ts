import { randomUUID } from 'node:crypto'
import { readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { resolveConversationTarget, startConversation } from '../../src/lib/conversation-target.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let agentId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())

test('a new conversation is an empty Pi session that opens with its own id, and becomes selected', () => {
  const conversation = startConversation(env.db, env.paths, agentId, 'Research')
  const path = join(env.paths.agentDir(agentId), 'sessions', `${conversation.id}.jsonl`)
  const session = SessionManager.open(path)
  expect(session.getSessionId()).toBe(conversation.id)
  expect(session.buildSessionContext().messages).toEqual([])
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(conversation.title).toBe('Research')
  expect(conversations.selectedId(env.db, agentId)).toBe(conversation.id)
  expect(readdirSync(join(env.paths.agentDir(agentId), 'sessions'))).toEqual([
    `${conversation.id}.jsonl`,
  ])
})

test('turns create one first conversation, then follow the selection rather than file times', () => {
  const first = resolveConversationTarget(env.db, env.paths, agentId)
  expect(resolveConversationTarget(env.db, env.paths, agentId)).toEqual(first)
  const next = startConversation(env.db, env.paths, agentId)
  const future = new Date(Date.now() + 60_000)
  utimesSync(join(env.paths.agentDir(agentId), 'sessions', `${first.id}.jsonl`), future, future)
  expect(resolveConversationTarget(env.db, env.paths, agentId).id).toBe(next.id)
  // A queued follow-up keeps the conversation it was sent to.
  expect(resolveConversationTarget(env.db, env.paths, agentId, first.id)).toEqual(first)
  expect(conversations.selectedId(env.db, agentId)).toBe(next.id)
})

test('a missing transcript or an unknown conversation is an error, never a silent replacement', () => {
  const first = resolveConversationTarget(env.db, env.paths, agentId)
  unlinkSync(join(env.paths.agentDir(agentId), 'sessions', `${first.id}.jsonl`))
  expect(() => resolveConversationTarget(env.db, env.paths, agentId)).toThrow()
  expect(() => resolveConversationTarget(env.db, env.paths, agentId, randomUUID())).toThrow()
  expect(conversations.list(env.db, agentId).total).toBe(1)
  expect(conversations.selectedId(env.db, agentId)).toBe(first.id)
})
