import { afterEach, beforeEach, expect, test } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let triggerId: string

beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    dir: env.paths.profileDir('p'),
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
    dir: env.paths.agentDir('a1'),
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
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })
  const replay = triggerDispatchRepo.materialize(env.db, {
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 3_000,
  })
  expect(replay.id).toBe(first.id)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)).toHaveLength(1)
  expect(triggerDispatchRepo.hasOpenForTrigger(env.db, triggerId)).toBe(true)
})

test('claim is atomic and an expired running lease is recoverable', () => {
  const dispatch = triggerDispatchRepo.materialize(env.db, {
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })
  expect(
    triggerDispatchRepo.claim(env.db, dispatch.id, { now: 2_000, leaseMs: 100 }),
  ).toMatchObject({
    status: 'running',
    attemptCount: 1,
  })
  expect(triggerDispatchRepo.claim(env.db, dispatch.id, { now: 2_050 })).toBeNull()
  expect(triggerDispatchRepo.claim(env.db, dispatch.id, { now: 2_101 })).toMatchObject({
    status: 'running',
    attemptCount: 2,
  })
})

test('fail retries with backoff and becomes terminal at the attempt bound', () => {
  const dispatch = triggerDispatchRepo.materialize(env.db, {
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })
  triggerDispatchRepo.claim(env.db, dispatch.id, { now: 2_000 })
  triggerDispatchRepo.fail(env.db, dispatch.id, 'temporary', {
    now: 2_100,
    maxAttempts: 2,
    retryDelayMs: 10,
  })
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)[0]).toMatchObject({
    status: 'retrying',
    nextAttemptAt: 2_110,
    lastError: 'temporary',
  })
  triggerDispatchRepo.claim(env.db, dispatch.id, { now: 2_110 })
  triggerDispatchRepo.fail(env.db, dispatch.id, 'permanent', {
    now: 2_120,
    maxAttempts: 2,
    retryDelayMs: 10,
  })
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)[0]).toMatchObject({
    status: 'failed',
    attemptCount: 2,
    finishedAt: 2_120,
    lastError: 'permanent',
  })
})

test('disabling a trigger cancels pending and retrying dispatches', () => {
  triggerDispatchRepo.materialize(env.db, {
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })
  triggerRepo.setEnabled(env.db, triggerId, false)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)[0]?.status).toBe('cancelled')
})

test('deleting a trigger cascades its dispatch diagnostics', () => {
  triggerDispatchRepo.materialize(env.db, {
    triggerId,
    agentId: 'a1',
    scheduledAt: 1_000,
    now: 2_000,
  })
  triggerRepo.remove(env.db, triggerId)
  expect(triggerDispatchRepo.listForTrigger(env.db, triggerId)).toEqual([])
})
