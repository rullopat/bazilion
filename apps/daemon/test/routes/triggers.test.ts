import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-trigger-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

async function setupTrigger() {
  const { createProfile, registerTeam, spawnAgent, triggerRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { triggersRouter } = await import('../../src/routes/triggers.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'profile', defaultModel: 'lmstudio:model' })
  registerTeam(ctx.db, { id: 'team' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'profile', teamId: 'team' })
  const trigger = triggerRepo.insert(ctx.db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 60,
    message: 'work',
  })
  return { ctx, trigger, triggersRouter }
}

describe('GET /:id/dispatches limit', () => {
  test.each(['not-a-number', '0', '-1', '1.5'])('rejects invalid limit %s', async (limit) => {
    const { trigger, triggersRouter } = await setupTrigger()
    const response = await triggersRouter.request(`/${trigger.id}/dispatches?limit=${limit}`)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'limit must be a positive integer' })
  })

  test('caps a large valid limit at 100 dispatches', async () => {
    const { ctx, trigger, triggersRouter } = await setupTrigger()
    const { triggerDispatchRepo } = await import('../../src/core/index.ts')
    for (let scheduledAt = 1; scheduledAt <= 101; scheduledAt += 1) {
      triggerDispatchRepo.materialize(ctx.db, {
        conversationId: seedRegisteredConversation(ctx.db, ctx.paths, trigger.agentId).id,
        triggerId: trigger.id,
        agentId: trigger.agentId,
        scheduledAt,
      })
    }

    const response = await triggersRouter.request(`/${trigger.id}/dispatches?limit=1000`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { dispatches: Array<{ scheduledAt: number }> }
    expect(body.dispatches).toHaveLength(100)
    expect(body.dispatches[0]?.scheduledAt).toBe(101)
    expect(body.dispatches.at(-1)?.scheduledAt).toBe(2)
  })
})

test.each([
  0.5, 1.5, 0,
])('an interval of %s seconds is refused instead of never firing', async (intervalSec) => {
  const { trigger } = await setupTrigger()
  const { agentTriggersRouter } = await import('../../src/routes/triggers.ts')
  const response = await agentTriggersRouter.request(`/${trigger.agentId}/triggers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'interval', intervalSec, message: 'work' }),
  })
  expect(response.status).toBe(400)
})

test('a schedule says when it runs next; the scheduler being off says none does', async () => {
  const { ctx, trigger } = await setupTrigger()
  const { nextRunAt } = await import('../../src/lib/trigger-timing.ts')
  const { triggerRepo } = await import('../../src/core/index.ts')
  const now = trigger.createdAt + 10_000
  expect(nextRunAt(trigger, now)).toBe(trigger.createdAt + 60_000)
  // Overdue: it runs at the next tick.
  expect(nextRunAt(trigger, trigger.createdAt + 120_000)).toBe(trigger.createdAt + 120_000)
  const cron = triggerRepo.insert(ctx.db, {
    agentId: trigger.agentId,
    kind: 'cron',
    cronExpr: '*/5 * * * *',
    message: 'cron work',
  })
  const minute = Math.floor(now / 300_000) * 300_000
  // A minute it already ran in does not count again.
  expect(nextRunAt({ ...cron, lastFiredAt: minute }, minute + 1000)).toBe(minute + 300_000)
  expect(nextRunAt({ ...cron, enabled: false }, now)).toBeNull()

  const { agentTriggersRouter } = await import('../../src/routes/triggers.ts')
  const off = await (await agentTriggersRouter.request(`/${trigger.agentId}/triggers`)).json()
  expect(off).toMatchObject({ schedulerOff: true, nextRuns: { [trigger.id]: null } })
  process.env.BAZILION_SCHEDULER = 'on'
  const on = (await (await agentTriggersRouter.request(`/${trigger.agentId}/triggers`)).json()) as {
    schedulerOff: boolean
    nextRuns: Record<string, number | null>
  }
  expect(on.schedulerOff).toBe(false)
  expect(typeof on.nextRuns[cron.id]).toBe('number')
})

describe('one-time schedules and changes', () => {
  test('creates a one-time schedule in the future and refuses one in the past', async () => {
    const { ctx, trigger } = await setupTrigger()
    const { agentTriggersRouter } = await import('../../src/routes/triggers.ts')
    const path = `/${trigger.agentId}/triggers`
    const runAt = Date.now() + 3_600_000
    const created = await agentTriggersRouter.request(path, {
      method: 'POST',
      body: JSON.stringify({ kind: 'once', runAt, message: 'renew the domain' }),
    })
    expect(created.status).toBe(201)
    expect(((await created.json()) as { trigger: unknown }).trigger).toMatchObject({
      kind: 'once',
      runAt,
      setBy: 'owner',
      conversationId: null,
      intervalSec: null,
      cronExpr: null,
    })
    const past = await agentTriggersRouter.request(path, {
      method: 'POST',
      body: JSON.stringify({ kind: 'once', runAt: Date.now() - 1000, message: 'late' }),
    })
    expect(past.status).toBe(400)
    expect(await past.json()).toEqual({ error: 'runAt is in the past' })
    expect(ctx.db.raw.query('SELECT count(*) AS n FROM agent_triggers').get()).toEqual({ n: 2 })
  })

  test('PATCH changes the message and the timing, checking all of it first', async () => {
    const { ctx, trigger, triggersRouter } = await setupTrigger()
    const { triggerRepo } = await import('../../src/core/index.ts')
    const patch = (body: unknown) =>
      triggersRouter.request(`/${trigger.id}`, { method: 'PATCH', body: JSON.stringify(body) })

    const bad = await patch({ message: 'new words', kind: 'cron', cronExpr: '61 * * * *' })
    expect(bad.status).toBe(400)
    expect(triggerRepo.get(ctx.db, trigger.id)).toMatchObject({ message: 'work', kind: 'interval' })

    const changed = await patch({ message: 'new words', kind: 'cron', cronExpr: '0  9 * * 1-5' })
    expect(changed.status).toBe(200)
    expect(((await changed.json()) as { trigger: unknown }).trigger).toMatchObject({
      message: 'new words',
      kind: 'cron',
      cronExpr: '0 9 * * 1-5',
      intervalSec: null,
    })
    expect((await patch({ message: '  ' })).status).toBe(400)
  })
})
