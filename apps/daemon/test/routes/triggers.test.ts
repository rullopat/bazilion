import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
    cronExpr: null,
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
        triggerId: trigger.id,
        agentId: trigger.agentId,
        scheduledAt,
        now: scheduledAt,
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
