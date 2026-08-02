import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as approvalRepo from '../../src/core/repos/communicationApprovals.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { authorizeInSnapshot } from '../../src/core/team-policy/authorization.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

interface TurnPlan {
  frames?: ChatFrame[]
  error?: Error
  abort?: boolean
}

interface TurnOptions {
  acquiredLeaseRelease?: () => void
  controller?: AbortController
}

describe('durable scheduler dispatches', () => {
  let env: TestEnv
  let scheduler: typeof import('../../src/lib/scheduler.ts')
  let turnPlans: TurnPlan[]
  let turnCalls: Array<{ agentId: string; message: string }>
  let oldEnforcement: string | undefined
  let oldTickMs: string | undefined

  beforeEach(async () => {
    oldEnforcement = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    oldTickMs = process.env.BAZILION_SCHEDULER_TICK_MS
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'off'
    process.env.BAZILION_SCHEDULER_TICK_MS = '1000'
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
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
    turnPlans = []
    turnCalls = []
    vi.resetModules()
    vi.doMock('../../src/lib/ctx.ts', () => ({
      getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-token' }),
    }))
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      runAgentTurn: (agentId: string, message: string, options: TurnOptions = {}) => {
        turnCalls.push({ agentId, message })
        const plan = turnPlans.shift() ?? { frames: [{ kind: 'done', messages: [] }] }
        return (async function* () {
          try {
            if (plan.abort) options.controller?.abort()
            for (const frame of plan.frames ?? []) yield frame
            if (plan.error) throw plan.error
          } finally {
            options.acquiredLeaseRelease?.()
            unregisterAgent(agentId)
          }
        })()
      },
    }))
    scheduler = await import('../../src/lib/scheduler.ts')
    scheduler._resetSchedulerForTest()
  })

  afterEach(() => {
    scheduler._resetSchedulerForTest()
    unregisterAgent('a1')
    env.cleanup()
    vi.doUnmock('../../src/lib/ctx.ts')
    vi.doUnmock('../../src/lib/agent-turn.ts')
    vi.resetModules()
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (oldEnforcement === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldEnforcement
    if (oldTickMs === undefined) delete process.env.BAZILION_SCHEDULER_TICK_MS
    else process.env.BAZILION_SCHEDULER_TICK_MS = oldTickMs
  })

  function materialize() {
    const now = Date.now()
    const trigger = triggerRepo.insert(env.db, {
      agentId: 'a1',
      kind: 'interval',
      intervalSec: 60,
      cronExpr: null,
      message: 'scheduled work',
    })
    const dispatch = triggerDispatchRepo.materialize(env.db, {
      triggerId: trigger.id,
      agentId: 'a1',
      scheduledAt: now,
      now,
    })
    return { trigger, dispatch }
  }

  test('records a successful turn as a succeeded dispatch', async () => {
    const { trigger } = materialize()

    await scheduler._tickOnce()

    expect(turnCalls).toEqual([{ agentId: 'a1', message: 'scheduled work' }])
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)[0]).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
      lastError: null,
    })
  })

  test('provider error frames retry the materialized occurrence despite a newer watermark', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    turnPlans.push(
      {
        frames: [
          { kind: 'event', event: { type: 'error', error: 'provider unavailable' } },
          { kind: 'done', messages: [] },
        ],
      },
      { frames: [{ kind: 'done', messages: [] }] },
    )
    const { trigger, dispatch } = materialize()

    await scheduler._tickOnce()
    const retry = triggerDispatchRepo.get(env.db, dispatch.id)
    expect(retry).toMatchObject({
      status: 'retrying',
      attemptCount: 1,
      lastError: 'provider unavailable',
    })

    triggerRepo.markFired(env.db, trigger.id, dispatch.scheduledAt + 30_000)
    vi.setSystemTime(retry?.nextAttemptAt as number)
    await scheduler._tickOnce()

    expect(turnCalls).toHaveLength(2)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
      lastError: null,
    })
  })

  test('provider failures become terminal after the bounded third attempt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    turnPlans.push(
      ...['first failure', 'second failure', 'final failure'].map((error) => ({
        frames: [{ kind: 'event' as const, event: { type: 'error' as const, error } }],
      })),
    )
    const { dispatch } = materialize()

    for (let attempt = 1; attempt <= 3; attempt++) {
      await scheduler._tickOnce()
      const current = triggerDispatchRepo.get(env.db, dispatch.id)
      expect(current?.attemptCount).toBe(attempt)
      if (attempt < 3) vi.setSystemTime(current?.nextAttemptAt as number)
    }

    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      lastError: 'final failure',
      finishedAt: expect.any(Number),
    })
  })

  test('defers without consuming an attempt while the target agent is busy', async () => {
    const { dispatch } = materialize()
    registerAgent('a1', new AbortController())

    await scheduler._tickOnce()
    const deferred = triggerDispatchRepo.get(env.db, dispatch.id)
    expect(deferred).toMatchObject({ status: 'pending', attemptCount: 0 })
    expect(turnCalls).toEqual([])

    unregisterAgent('a1')
    vi.setSystemTime(deferred?.nextAttemptAt as number)
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)?.status).toBe('succeeded')
  })

  test('coalesces later interval occurrences while one busy dispatch remains open', async () => {
    const baseline = Date.now()
    const trigger = triggerRepo.insert(env.db, {
      agentId: 'a1',
      kind: 'interval',
      intervalSec: 1,
      cronExpr: null,
      message: 'coalesced work',
    })
    registerAgent('a1', new AbortController())

    vi.setSystemTime(baseline + 1_000)
    await scheduler._tickOnce()
    vi.setSystemTime(baseline + 5_000)
    await scheduler._tickOnce()

    const dispatches = triggerDispatchRepo.listForTrigger(env.db, trigger.id)
    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toMatchObject({
      scheduledAt: baseline + 1_000,
      status: 'pending',
      attemptCount: 0,
    })
    expect(triggerRepo.get(env.db, trigger.id)?.lastFiredAt).toBe(baseline + 5_000)

    unregisterAgent('a1')
    vi.setSystemTime(dispatches[0]?.nextAttemptAt as number)
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatches[0]?.id as string)?.status).toBe('succeeded')
  })

  test('reclaims an abandoned running lease after restart', async () => {
    const { dispatch } = materialize()
    triggerDispatchRepo.claim(env.db, dispatch.id, { now: Date.now(), leaseMs: 100 })
    vi.setSystemTime(Date.now() + 101)

    await scheduler._tickOnce()

    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
    })
  })

  test('keeps approval-gated work pending until a durable grant is executed by a later tick', async () => {
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
    env.db.raw.run(
      `INSERT INTO team_policy_edges
         (team_id, source_kind, source_id, target_kind, target_id, posture)
       VALUES (?, 'user', '', 'agent', 'a1', 'approval_required')`,
      [env.teamId],
    )
    const { dispatch } = materialize()

    await scheduler._tickOnce()
    let deferred = triggerDispatchRepo.get(env.db, dispatch.id)
    expect(deferred).toMatchObject({ status: 'pending', attemptCount: 0 })
    expect(turnCalls).toEqual([])
    const approval = approvalRepo.list(env.db)[0]
    expect(approval).toMatchObject({
      operation: 'scheduler_trigger',
      payloadKind: 'scheduler_trigger',
      status: 'pending',
    })

    vi.setSystemTime(deferred?.nextAttemptAt as number)
    await scheduler._tickOnce()
    expect(approvalRepo.list(env.db)).toHaveLength(1)
    expect(turnCalls).toEqual([])

    const grant = approvalRepo.grantSchedulerTrigger(
      env.db,
      approval?.id as string,
      'operator',
      (item) =>
        authorizeInSnapshot(env.db, {
          source: item.source,
          target: item.target,
          origin: item.origin,
          attemptKind: item.attemptKind,
          attemptId: item.attemptId,
        }),
      () => null,
    )
    expect(grant).toMatchObject({ granted: true, approval: { status: 'delivered' } })
    expect(turnCalls).toEqual([])

    deferred = triggerDispatchRepo.get(env.db, dispatch.id)
    vi.setSystemTime(deferred?.nextAttemptAt as number)
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
    })
  })

  test('terminal approval denial fails the dispatch without starting a turn', async () => {
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
    env.db.raw.run(
      `INSERT INTO team_policy_edges
         (team_id, source_kind, source_id, target_kind, target_id, posture)
       VALUES (?, 'user', '', 'agent', 'a1', 'approval_required')`,
      [env.teamId],
    )
    const { dispatch } = materialize()

    await scheduler._tickOnce()
    approvalRepo.decide(env.db, approvalRepo.list(env.db)[0]?.id as string, 'deny', 'operator')
    const pending = triggerDispatchRepo.get(env.db, dispatch.id)
    vi.setSystemTime(pending?.nextAttemptAt as number)
    await scheduler._tickOnce()

    expect(turnCalls).toEqual([])
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'failed',
      attemptCount: 1,
    })
  })

  test('an aborted turn is recorded as cancelled instead of succeeded', async () => {
    turnPlans.push({ abort: true, frames: [{ kind: 'done', messages: [] }] })
    const { dispatch } = materialize()

    await scheduler._tickOnce()

    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'cancelled',
      attemptCount: 1,
      lastError: 'agent turn cancelled',
    })
  })
})
