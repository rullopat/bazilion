import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-learning-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})

afterEach(async () => {
  try {
    const { getCtx } = await import('../../src/lib/ctx.ts')
    getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('review configuration, enqueue, proposal editing, and private approval are exposed', async () => {
  const { createProfile, registerTeam, spawnAgent, agentLessonProposalRepo, agentReviewRepo } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const ctx = getCtx()
  const team = registerTeam(ctx.db, { id: 'g', name: 'team' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })

  const configured = await agentsRouter.request(`/${agent.id}/review-config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, everyNTurns: 4, reasoningLevel: 'medium' }),
  })
  expect(configured.status).toBe(200)
  expect(await configured.json()).toMatchObject({ enabled: true, everyNTurns: 4 })

  const enqueued = await agentsRouter.request(`/${agent.id}/reviews`, { method: 'POST' })
  expect(enqueued.status).toBe(202)
  const review = agentReviewRepo.listForAgent(ctx.db, agent.id)[0]
  expect(review).toBeDefined()
  const proposal = agentLessonProposalRepo.insert(ctx.db, {
    reviewId: review?.id ?? '',
    agentId: agent.id,
    scope: 'private',
    text: 'Draft lesson',
    evidence: [{ sessionId: 's', entryOrdinal: 1 }],
  })

  const edited = await agentsRouter.request(`/${agent.id}/lesson-proposals/${proposal.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, text: 'Approved lesson' }),
  })
  expect(edited.status).toBe(200)
  const approved = await agentsRouter.request(
    `/${agent.id}/lesson-proposals/${proposal.id}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 2 }),
    },
  )
  expect(approved.status).toBe(200)
  expect(await approved.json()).toMatchObject({ proposal: { status: 'approved', version: 3 } })
})
