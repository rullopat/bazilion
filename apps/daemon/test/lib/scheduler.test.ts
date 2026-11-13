import { join } from 'node:path'
import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { projectAttention } from '../../src/core/attention.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as conversations from '../../src/core/repos/conversations.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import * as triggerDispatchRepo from '../../src/core/repos/triggerDispatches.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedConversationTarget, seedRegisteredConversation } from '../fixtures/conversation.ts'

interface TurnPlan {
  frames?: ChatFrame[]
  error?: Error
  abort?: boolean
  /** Runs inside the turn, before it is aborted. */
  during?: () => void
}

interface PreparedTurnInput {
  agentId: string
  message: string
  conversationId: string
  claim?: { controller: AbortController }
}

describe('scheduler', () => {
  let env: TestEnv
  let scheduler: typeof import('../../src/lib/scheduler.ts')
  let targets: string[]
  let turnPlans: TurnPlan[]
  let turnCalls: Array<{ agentId: string; message: string }>
  let prepareError: Error | null
  let oldTickMs: string | undefined

  beforeEach(async () => {
    oldTickMs = process.env.BAZILION_SCHEDULER_TICK_MS
    process.env.BAZILION_SCHEDULER_TICK_MS = '1000'
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
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
    seedRegisteredConversation(env.db, env.paths, 'a1')
    targets = []
    turnPlans = []
    turnCalls = []
    prepareError = null
    vi.resetModules()
    vi.doMock('../../src/lib/ctx.ts', () => ({
      getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-token' }),
    }))
    vi.doMock('../../src/lib/agent-turn.ts', () => ({
      prepareAgentTurn: async (turn: PreparedTurnInput) => {
        if (prepareError) {
          // Like the real preparation: a scheduler turn gives back its registration.
          unregisterAgent(turn.agentId)
          throw prepareError
        }
        targets.push(turn.conversationId)
        turnCalls.push({ agentId: turn.agentId, message: turn.message })
        return turn
      },
      runAgentTurn: (turn: PreparedTurnInput) => {
        const plan = turnPlans.shift() ?? { frames: [{ kind: 'done', messages: [] }] }
        return (async function* () {
          try {
            plan.during?.()
            if (plan.abort) turn.claim?.controller.abort()
            for (const frame of plan.frames ?? []) yield frame
            if (plan.error) throw plan.error
          } finally {
            unregisterAgent(turn.agentId)
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
      conversationId: seedRegisteredConversation(env.db, env.paths, 'a1').id,
      triggerId: trigger.id,
      agentId: 'a1',
      scheduledAt: now,
    })
    return { trigger, dispatch }
  }

  test('delayed scheduled work keeps its materialized target after New conversation', async () => {
    const { dispatch } = materialize()
    const next = seedConversationTarget(join(env.paths.agentDir('a1'), 'sessions'), env.paths.home)
    conversations.create(env.db, 'a1', next.id)
    await scheduler._tickOnce()
    expect(targets).toEqual([dispatch.conversationId])
    expect(dispatch.conversationId).not.toBe(next.id)
    expect(conversations.selectedId(env.db, 'a1')).toBe(next.id)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)?.conversationId).toBe(
      dispatch.conversationId,
    )
  })

  test('records a successful turn as a succeeded dispatch', async () => {
    const { trigger } = materialize()

    await scheduler._tickOnce()

    expect(turnCalls).toEqual([{ agentId: 'a1', message: 'scheduled work' }])
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)[0]).toMatchObject({
      status: 'succeeded',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      error: null,
    })
  })

  test('inbox turn targets its exact conversation', async () => {
    agentRepo.insert(env.db, {
      id: 'a2',
      profileId: 'p',
      name: 'Sender',
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
    const message = messageRepo.send(env.db, {
      from: 'a2',
      to: 'a1',
      payload: JSON.stringify({ text: 'inbox task' }),
    })
    const selected = conversations.selectedId(env.db, 'a1')
    await scheduler._tickOnce()
    expect(targets).toEqual([selected])
    expect(messageRepo.get(env.db, message.id)?.readAt).not.toBeNull()
  })

  test('a failed inbox turn preparation leaves the messages unread and retries with backoff', async () => {
    agentRepo.insert(env.db, {
      id: 'a2',
      profileId: 'p',
      name: 'Sender',
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
    const message = messageRepo.send(env.db, {
      from: 'a2',
      to: 'a1',
      payload: JSON.stringify({ text: 'inbox task' }),
    })
    prepareError = new Error('BAZILION_BASH_SANDBOX must be "off" or "docker", received: bogus')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const retryDelays = () =>
      warn.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.includes('"inbox_wake_unavailable"'))
        .map((line) => (JSON.parse(line) as { retryInMs?: number }).retryInMs)
    const failedAt = Date.now()
    await scheduler._tickOnce()
    expect(turnCalls).toEqual([])
    expect(messageRepo.get(env.db, message.id)?.readAt).toBeNull()
    expect(messageRepo.listRecipientsWithUnread(env.db)).toEqual(['a1'])
    expect(retryDelays()).toEqual([10_000])

    // A lasting failure backs off instead of retrying on every tick, doubling each time.
    vi.setSystemTime(failedAt + 9_999)
    await scheduler._tickOnce()
    expect(retryDelays()).toEqual([10_000])
    vi.setSystemTime(failedAt + 10_000)
    await scheduler._tickOnce()
    expect(retryDelays()).toEqual([10_000, 20_000])
    expect(messageRepo.get(env.db, message.id)?.readAt).toBeNull()

    prepareError = null
    vi.setSystemTime(failedAt + 29_999)
    await scheduler._tickOnce()
    expect(turnCalls).toEqual([])
    vi.setSystemTime(failedAt + 30_000)
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(1)
    expect(messageRepo.get(env.db, message.id)?.readAt).not.toBeNull()

    // A started turn clears the backoff: the next message is delivered on the next tick.
    const next = messageRepo.send(env.db, {
      from: 'a2',
      to: 'a1',
      payload: JSON.stringify({ text: 'second inbox task' }),
    })
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(2)
    expect(messageRepo.get(env.db, next.id)?.readAt).not.toBeNull()
  })

  test('archived Agents get no scheduled or inbox turns until they are unarchived', async () => {
    agentRepo.insert(env.db, {
      id: 'a2',
      profileId: 'p',
      name: 'Sender',
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId: env.teamId,
    })
    const message = messageRepo.send(env.db, {
      from: 'a2',
      to: 'a1',
      payload: JSON.stringify({ text: 'mail from before the archive' }),
    })
    // This dispatch was materialized before the archive: it is cancelled when it fires.
    const { trigger, dispatch } = materialize()
    agentRepo.archive(env.db, 'a1')
    expect(messageRepo.listRecipientsWithUnread(env.db)).toEqual([])
    expect(triggerRepo.listEnabled(env.db)).toEqual([])

    await scheduler._tickOnce()
    vi.setSystemTime(Date.now() + 120_000)
    await scheduler._tickOnce()
    expect(turnCalls).toEqual([])
    expect(messageRepo.get(env.db, message.id)?.readAt).toBeNull()
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)).toEqual([
      expect.objectContaining({
        id: dispatch.id,
        status: 'cancelled',
        error: 'agent is archived',
      }),
    ])

    // Once unarchived, the waiting mail is delivered and the trigger fires again.
    agentRepo.unarchive(env.db, 'a1')
    await scheduler._tickOnce()
    await scheduler._tickOnce()
    expect(messageRepo.get(env.db, message.id)?.readAt).not.toBeNull()
    expect(turnCalls.map((call) => call.message)).toEqual(
      expect.arrayContaining([
        'scheduled work',
        expect.stringContaining('mail from before the archive'),
      ]),
    )
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)).toHaveLength(2)
  })

  test('an Agent in a lifecycle mutation is skipped until it ends, without holding up the tick', async () => {
    const { runAgentLifecycleMutation } = await import('../../src/lib/agent-cancel.ts')
    const message = messageRepo.send(env.db, {
      from: 'a1',
      to: 'a1',
      payload: JSON.stringify({ text: 'waiting inbox work' }),
    })
    let finish: () => void = () => {}
    const mutation = runAgentLifecycleMutation(
      'a1',
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    await scheduler._tickOnce()
    expect(turnCalls).toEqual([])
    expect(messageRepo.get(env.db, message.id)?.readAt).toBeNull()
    finish()
    await mutation
    await scheduler._tickOnce()
    expect(messageRepo.get(env.db, message.id)?.readAt).not.toBeNull()
    expect(turnCalls.map((call) => call.message)).toEqual([
      expect.stringContaining('waiting inbox work'),
    ])
  })

  test('a failed turn is recorded once as failed, shows in Attention and is never retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    turnPlans.push({
      frames: [
        { kind: 'event', event: { type: 'error', error: 'provider unavailable' } },
        { kind: 'done', messages: [] },
      ],
    })
    const { dispatch } = materialize()

    await scheduler._tickOnce()
    // Well past the old retry delays, still before the trigger's next 60 s occurrence.
    vi.setSystemTime(Date.now() + 30_000)
    await scheduler._tickOnce()

    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'failed',
      error: 'provider unavailable',
      finishedAt: expect.any(Number),
    })
    const failureItem = projectAttention(env.db, { state: 'open', limit: 100 }).items.find(
      (item) => item.kind === 'trigger_failure' && item.sourceId === dispatch.id,
    )
    expect(failureItem?.severity).toBe('error')
    expect(failureItem?.diagnostic).toBe('provider unavailable')
  })

  test('a busy Agent keeps the occurrence pending until it is free', async () => {
    const { dispatch } = materialize()
    registerAgent('a1', new AbortController())

    await scheduler._tickOnce()
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'pending',
      startedAt: null,
    })
    expect(turnCalls).toEqual([])

    unregisterAgent('a1')
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
    expect(dispatches[0]).toMatchObject({ scheduledAt: baseline + 1_000, status: 'pending' })
    expect(triggerRepo.get(env.db, trigger.id)?.lastFiredAt).toBe(baseline + 5_000)

    unregisterAgent('a1')
    await scheduler._tickOnce()
    expect(turnCalls).toHaveLength(1)
    expect(triggerDispatchRepo.get(env.db, dispatches[0]?.id as string)?.status).toBe('succeeded')
  })

  test('a run interrupted by a daemon stop is failed at boot and never re-run', async () => {
    const { dispatch } = materialize()
    // The daemon died while this occurrence was running.
    expect(triggerDispatchRepo.start(env.db, dispatch.id)).toBe(true)

    triggerDispatchRepo.failInterrupted(env.db)
    await scheduler._tickOnce()

    expect(turnCalls).toEqual([])
    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'failed',
      error: triggerDispatchRepo.INTERRUPTED,
    })
  })

  test('a turn aborted by daemon shutdown is recorded as failed', async () => {
    turnPlans.push({ abort: true, during: () => void scheduler.stopScheduler() })
    const { dispatch } = materialize()

    await scheduler._tickOnce()

    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'failed',
      error: triggerDispatchRepo.INTERRUPTED,
    })
  })

  test('an aborted turn is recorded as cancelled instead of succeeded', async () => {
    turnPlans.push({ abort: true, frames: [{ kind: 'done', messages: [] }] })
    const { dispatch } = materialize()

    await scheduler._tickOnce()

    expect(triggerDispatchRepo.get(env.db, dispatch.id)).toMatchObject({
      status: 'cancelled',
      error: 'agent turn cancelled',
    })
  })

  test('a cron minute missed while the daemon was down does not fire after restart', async () => {
    // Local wall-clock times: cron matches in the daemon's own timezone.
    const at = (day: number, hour: number, minute: number) =>
      new Date(2026, 0, day, hour, minute).getTime()
    vi.setSystemTime(at(14, 8, 0))
    const trigger = triggerRepo.insert(env.db, {
      agentId: 'a1',
      kind: 'cron',
      intervalSec: null,
      cronExpr: '0 9 * * *',
      message: 'daily work',
    })
    vi.setSystemTime(at(14, 8, 59))
    await scheduler._tickOnce()
    // Down across 09:00; the first tick after the restart is at 09:01.
    vi.setSystemTime(at(14, 9, 1))
    await scheduler._tickOnce()
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)).toEqual([])

    vi.setSystemTime(at(15, 9, 0))
    await scheduler._tickOnce()
    vi.setSystemTime(at(15, 9, 0) + 30_000)
    await scheduler._tickOnce()
    expect(triggerDispatchRepo.listForTrigger(env.db, trigger.id)).toEqual([
      expect.objectContaining({ scheduledAt: at(15, 9, 0), status: 'succeeded' }),
    ])
    expect(turnCalls).toHaveLength(1)
  })
})
