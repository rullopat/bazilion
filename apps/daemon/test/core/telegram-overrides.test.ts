// Per-agent-topic override repo: defaults, merge-upsert, allow_from JSON.

import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as overrides from '../../src/core/repos/telegram-overrides.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let agentId: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
  agentId = spawnAgent(env.db, env.paths, {
    profileId: 'base',
    groupId: env.groupId,
    name: 'r1',
  }).id
})
afterEach(() => env.cleanup())

test('get returns null before any override is set', () => {
  expect(overrides.get(env.db, agentId)).toBeNull()
})

test('set merges fields and persists allow_from as JSON', () => {
  overrides.set(env.db, agentId, { requireMention: true })
  let o = overrides.get(env.db, agentId)
  expect(o?.requireMention).toBe(true)
  expect(o?.silent).toBe(false)
  expect(o?.allowFrom).toEqual([])

  // Merge: setting silent leaves requireMention intact.
  overrides.set(env.db, agentId, { silent: true, allowFrom: [11, 22] })
  o = overrides.get(env.db, agentId)
  expect(o?.requireMention).toBe(true)
  expect(o?.silent).toBe(true)
  expect(o?.allowFrom).toEqual([11, 22])
})

test('remove clears the override back to defaults (null)', () => {
  overrides.set(env.db, agentId, { silent: true })
  overrides.remove(env.db, agentId)
  expect(overrides.get(env.db, agentId)).toBeNull()
})
