import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined
let oldGate: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  oldGate = process.env.BAZILION_HARNESS_ENFORCEMENT
  home = mkdtempSync(join(tmpdir(), 'bazilion-communication-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  process.env.BAZILION_HARNESS_ENFORCEMENT = 'on'
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
  if (oldGate === undefined) delete process.env.BAZILION_HARNESS_ENFORCEMENT
  else process.env.BAZILION_HARNESS_ENFORCEMENT = oldGate
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('authenticated evaluator is side-effect free and block history is filtered and cursor paginated', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerGroup, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerGroup(ctx.db, { id: 'default' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', groupId: 'default' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', groupId: 'default' })
  ctx.db.raw.run('DELETE FROM live_harness_edges WHERE group_id = ?', ['default'])
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }

  expect(
    (
      await app.request('/api/communication/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(401)
  const input = {
    source: { kind: 'agent', id: a.id },
    target: { kind: 'agent', id: b.id },
    origin: 'diagnostic',
    attemptKind: 'diagnostic',
    attemptId: 'one',
  }
  const evaluated = await app.request('/api/communication/evaluate', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(input),
  })
  expect(evaluated.status).toBe(200)
  expect(await evaluated.json()).toMatchObject({ decision: 'deny', reasonCode: 'no_allow_edge' })
  expect(
    ctx.db.raw.query<{ count: number }, []>('SELECT COUNT(*) count FROM harness_block_events').get()
      ?.count,
  ).toBe(0)

  for (const id of ['one', 'two']) {
    const response = await app.request(`/api/agents/${b.id}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': id },
      body: JSON.stringify({ from: a.id, payload: { text: `secret-${id}` } }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      decision: 'deny',
      reasonCode: 'no_allow_edge',
      attemptKind: 'http_agent_message',
      attemptId: id,
    })
  }
  const page1 = await app.request('/api/groups/default/harness/blocks?limit=1', { headers: auth })
  expect(page1.status).toBe(200)
  const first = (await page1.json()) as {
    blocks: Array<{ reason_code: string; origin: string }>
    nextCursor: string
  }
  expect(first.blocks).toHaveLength(1)
  expect(first.blocks[0]).toMatchObject({
    reason_code: 'no_allow_edge',
    origin: 'http_agent_message',
  })
  expect(JSON.stringify(first)).not.toContain('secret-')
  const page2 = await app.request(
    `/api/groups/default/harness/blocks?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    { headers: auth },
  )
  expect(((await page2.json()) as { blocks: unknown[] }).blocks).toHaveLength(1)
  const filtered = await app.request(
    '/api/groups/default/harness/blocks?reasonCode=agent_archived',
    { headers: auth },
  )
  expect(((await filtered.json()) as { blocks: unknown[] }).blocks).toEqual([])
})
