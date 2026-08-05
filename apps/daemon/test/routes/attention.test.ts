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
  home = mkdtempSync(join(tmpdir(), 'bazilion-attention-route-'))
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

async function fixture() {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const now = Date.now()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  ctx.db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('team', 'Team', ?)", [now])
  ctx.db.raw.run(
    `INSERT INTO profiles (id, name, dir, default_model, created_at, updated_at)
     VALUES ('profile', 'Profile', 'profile', 'lmstudio:qa', ?, ?)`,
    [now, now],
  )
  ctx.db.raw.run(
    `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
     VALUES ('agent', 'profile', 'Agent', 'idle', 'agent', 'team', ?)`,
    [now],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_reviews
       (id, agent_id, status, trigger_kind, next_attempt_at, last_error, created_at, updated_at)
     VALUES ('failed-review', 'agent', 'failed', 'manual', ?, 'safe failure', ?, ?)`,
    [now, now - 2, now - 1],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_reviews
       (id, agent_id, status, trigger_kind, next_attempt_at, proposal_count,
        finished_at, created_at, updated_at)
     VALUES ('complete-review', 'agent', 'completed', 'manual', ?, 1, ?, ?, ?)`,
    [now, now, now, now],
  )
  ctx.db.raw.run(
    `INSERT INTO agent_lesson_proposals
       (id, review_id, agent_id, scope, text, evidence_json, status, created_at, updated_at)
     VALUES ('lesson', 'complete-review', 'agent', 'private', 'Lesson', '[]', 'pending', ?, ?)`,
    [now, now],
  )
  return {
    app: createApp(),
    auth: { authorization: `Bearer ${ctx.authToken}` },
  }
}

test('attention routes require auth and validate list filters', async () => {
  const { app, auth } = await fixture()
  expect((await app.request('/api/attention')).status).toBe(401)

  for (const query of ['state=invalid', 'kind=invalid', 'limit=201']) {
    const response = await app.request(`/api/attention?${query}`, { headers: auth })
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('code')
  }

  const response = await app.request('/api/attention?state=open&kind=review_failure', {
    headers: auth,
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    items: [{ key: 'review_failure:failed-review', acknowledgeable: true }],
    degraded: [],
  })
})

test('acknowledgement lifecycle is idempotent and action-required work stays source-owned', async () => {
  const { app, auth } = await fixture()
  const reviewKey = encodeURIComponent('review_failure:failed-review')
  const lessonKey = encodeURIComponent('lesson_proposal:lesson')

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request(`/api/attention/${reviewKey}/acknowledge`, {
      method: 'POST',
      headers: auth,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ item: { acknowledgedAt: expect.any(Number) } })
  }

  const history = await app.request('/api/attention?state=acknowledged', { headers: auth })
  expect(await history.json()).toMatchObject({ items: [{ key: 'review_failure:failed-review' }] })

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await app.request(`/api/attention/${reviewKey}/acknowledgement`, {
      method: 'DELETE',
      headers: auth,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ item: { acknowledgedAt: null } })
  }

  const protectedResponse = await app.request(`/api/attention/${lessonKey}/acknowledge`, {
    method: 'POST',
    headers: auth,
  })
  expect(protectedResponse.status).toBe(409)
  expect(await protectedResponse.json()).toMatchObject({ code: 'attention_action_required' })

  const stale = await app.request('/api/attention/review_failure%3Amissing/acknowledge', {
    method: 'POST',
    headers: auth,
  })
  expect(stale.status).toBe(404)
  expect(await stale.json()).toMatchObject({ code: 'attention_source_not_found' })
})

test('acknowledge-all and summary use the same open projection', async () => {
  const { app, auth } = await fixture()
  const before = await app.request('/api/attention/summary', { headers: auth })
  expect(await before.json()).toMatchObject({
    openTotal: 2,
    bySeverity: { action_required: 1, error: 1, warning: 0 },
  })

  const acknowledged = await app.request('/api/attention/acknowledge-all', {
    method: 'POST',
    headers: auth,
  })
  expect(await acknowledged.json()).toEqual({ acknowledged: 1 })

  const after = await app.request('/api/attention/summary', { headers: auth })
  expect(await after.json()).toMatchObject({
    openTotal: 1,
    bySeverity: { action_required: 1, error: 0, warning: 0 },
  })
  const open = await app.request('/api/attention?state=open', { headers: auth })
  expect(await open.json()).toMatchObject({ items: [{ key: 'lesson_proposal:lesson' }] })
})
