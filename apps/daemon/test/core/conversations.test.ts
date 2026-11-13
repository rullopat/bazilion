import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'test', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
})
afterEach(() => env.cleanup())

test('creating a conversation selects it; the default title counts the Agent’s conversations', () => {
  expect(conversations.selectedId(env.db, agentId)).toBeNull()
  const first = conversations.create(env.db, agentId, randomUUID())
  expect(first.title).toBe('Conversation 1')
  expect(conversations.selectedId(env.db, agentId)).toBe(first.id)
  const second = conversations.create(env.db, agentId, randomUUID(), '  Launch plan ')
  expect(second.title).toBe('Launch plan')
  expect(conversations.selectedId(env.db, agentId)).toBe(second.id)
  expect(conversations.list(env.db, agentId)).toMatchObject({ total: 2, selectedId: second.id })
  expect(() => conversations.create(env.db, agentId, randomUUID(), '\u0007')).toThrow('title')
})

test('renaming changes the title only, never the selection', () => {
  const first = conversations.create(env.db, agentId, randomUUID())
  const second = conversations.create(env.db, agentId, randomUUID())
  expect(conversations.rename(env.db, agentId, first.id, 'Earlier task').title).toBe('Earlier task')
  expect(conversations.selectedId(env.db, agentId)).toBe(second.id)
  expect(() => conversations.rename(env.db, agentId, first.id, '')).toThrow('title')
})

test('Agent boundaries, pagination and lifecycle', () => {
  const first = conversations.create(env.db, agentId, randomUUID())
  const other = spawnAgent(env.db, env.paths, { profileId: 'test', teamId: env.teamId }).id
  expect(conversations.get(env.db, other, first.id)).toBeNull()
  expect(() => conversations.rename(env.db, other, first.id, 'Foreign')).toThrow('not found')
  expect(() => conversations.list(env.db, agentId, 101)).toThrow()
  expect(() => conversations.list(env.db, agentId, 20, -1)).toThrow()
  env.db.raw.run('DELETE FROM agents WHERE id = ?', [agentId])
  expect(conversations.list(env.db, agentId).total).toBe(0)
  expect(conversations.selectedId(env.db, agentId)).toBeNull()
})
