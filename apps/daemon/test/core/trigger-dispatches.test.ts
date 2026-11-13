import { afterEach, beforeEach, expect, test } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let triggerId: string

beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  agentRepo.insert(env.db, {
    id: 'a1',
    profileId: 'p',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    teamId: env.teamId,
  })
  triggerId = triggerRepo.insert(env.db, {
    agentId: 'a1',
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'work',
  }).id
})

afterEach(() => env.cleanup())

test('materialization is idempotent per trigger occurrence', () => {
  const first = triggerDispatchRepo.materialize(env.db, {
    conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  const replay = triggerDispatchRepo.materialize(env.db, {
    conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  expect(replay.id).toBe(first.id)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)).toHaveLength(1)
  expect(triggerDispatchRepo.hasOpenForTrigger(env.db, triggerId)).toBe(true)
})

test('an occurrence starts once and closes once', () => {
  const dispatch = triggerDispatchRepo.materialize(env.db, {
    conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  expect(triggerDispatchRepo.listPending(env.db).map((d) => d.id)).toEqual([dispatch.id])
  expect(triggerDispatchRepo.start(env.db, dispatch.id, 2_000)).toBe(true)
  expect(triggerDispatchRepo.start(env.db, dispatch.id, 2_001)).toBe(false)
  expect(triggerDispatchRepo.listPending(env.db)).toEqual([])
  expect(triggerDispatchRepo.hasOpenForTrigger(env.db, triggerId)).toBe(true)

  triggerDispatchRepo.finish(env.db, dispatch.id, 'failed', 'provider unavailable', 3_000)
  // A closed occurrence stays closed.
  triggerDispatchRepo.finish(env.db, dispatch.id, 'succeeded', null, 4_000)
  expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
    status: 'failed',
    startedAt: 2_000,
    finishedAt: 3_000,
    error: 'provider unavailable',
  })
  expect(triggerDispatchRepo.hasOpenForTrigger(env.db, triggerId)).toBe(false)
})

test('the boot sweep fails running occurrences and leaves pending ones', () => {
  const conversationId = seedRegisteredConversation(env.db, env.paths, 'a1').id
  const running = triggerDispatchRepo.materialize(env.db, {
    conversationId,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  const pending = triggerDispatchRepo.materialize(env.db, {
    conversationId,
    triggerId,
    agentId: 'a1',
    scheduledAt: 2_000,
  })
  triggerDispatchRepo.start(env.db, running.id)
  triggerDispatchRepo.failInterrupted(env.db, 5_000)
  expect(triggerDispatchRepo.get(env.db, running.id)).toMatchObject({
    status: 'failed',
    finishedAt: 5_000,
    error: triggerDispatchRepo.INTERRUPTED,
  })
  expect(triggerDispatchRepo.get(env.db, pending.id)?.status).toBe('pending')
})

test('disabling a trigger cancels its pending dispatches', () => {
  triggerDispatchRepo.materialize(env.db, {
    conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  triggerRepo.setEnabled(env.db, triggerId, false)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)[0]?.status).toBe('cancelled')
})

test('deleting a trigger cascades its run history', () => {
  triggerDispatchRepo.materialize(env.db, {
    conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
  })
  triggerRepo.remove(env.db, triggerId)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)).toEqual([])
})
