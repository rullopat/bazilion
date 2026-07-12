// agentRepo.toAgent shape after migrations 0003 + 0004.
// telegramTopicId surfaces on Agent so the web UI can show the binding
// without an extra round-trip; telegramMirrorMode falls back to 'minimal'
// when missing (DEFAULT applies).

import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
})
afterEach(() => env.cleanup())

test('newly-spawned agent has telegramTopicId=null and mirror=minimal', () => {
  const a = spawnAgent(env.db, env.paths, {
    profileId: 'base',
    teamId: env.teamId,
    name: 'r1',
  })
  expect(a.telegramTopicId).toBeNull()
  expect(a.telegramMirrorMode).toBe('minimal')

  // Read-back via repo.get returns the same shape.
  const fetched = agentRepo.get(env.db, a.id)
  expect(fetched).not.toBeNull()
  expect(fetched?.telegramTopicId).toBeNull()
  expect(fetched?.telegramMirrorMode).toBe('minimal')
})

test('binding + mirror-mode changes round-trip through agentRepo', () => {
  const a = spawnAgent(env.db, env.paths, {
    profileId: 'base',
    teamId: env.teamId,
    name: 'r1',
  })
  agentRepo.setTelegramTopicId(env.db, a.id, 42)
  agentRepo.setTelegramMirrorMode(env.db, a.id, 'verbose')
  const fetched = agentRepo.get(env.db, a.id)
  expect(fetched?.telegramTopicId).toBe(42)
  expect(fetched?.telegramMirrorMode).toBe('verbose')

  // Clearing the binding flips back to null.
  agentRepo.setTelegramTopicId(env.db, a.id, null)
  expect(agentRepo.get(env.db, a.id)?.telegramTopicId).toBeNull()
})

test('agentRepo.list rows carry telegramTopicId', () => {
  const a = spawnAgent(env.db, env.paths, {
    profileId: 'base',
    teamId: env.teamId,
    name: 'r1',
  })
  agentRepo.setTelegramTopicId(env.db, a.id, 99)
  const all = agentRepo.list(env.db)
  const r1 = all.find((x) => x.id === a.id)
  expect(r1?.telegramTopicId).toBe(99)
})
