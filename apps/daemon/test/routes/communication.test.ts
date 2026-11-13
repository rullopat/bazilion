import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined
let oldLoopLimit: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  oldLoopLimit = process.env.BAZILION_AGENT_LOOP_MAX_HOPS
  home = mkdtempSync(join(tmpdir(), 'bazilion-communication-route-'))
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
  if (oldLoopLimit === undefined) delete process.env.BAZILION_AGENT_LOOP_MAX_HOPS
  else process.env.BAZILION_AGENT_LOOP_MAX_HOPS = oldLoopLimit
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('agent message endpoint stops over-budget causal chains and exposes payload-free diagnostics', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  process.env.BAZILION_AGENT_LOOP_MAX_HOPS = '0'
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }

  const first = await app.request(`/api/agents/${b.id}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ from: a.id, payload: { text: 'first payload' } }),
  })
  expect(first.status).toBe(201)
  const firstMessage = (await first.json()) as {
    id: string
    causalChainId: string
    causalHop: number
  }
  expect(firstMessage).toMatchObject({ causalChainId: firstMessage.id, causalHop: 0 })

  const blocked = await app.request(`/api/agents/${a.id}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      from: b.id,
      replyTo: firstMessage.id,
      payload: { text: 'secret blocked payload' },
    }),
  })
  expect(blocked.status).toBe(429)
  expect(await blocked.json()).toEqual({
    error: `agent message chain ${firstMessage.id} stopped at hop 1 (limit 0)`,
  })

  const diagnostics = await app.request(`/api/agents/${a.id}/loop-breaks`, { headers: auth })
  expect(diagnostics.status).toBe(200)
  const text = await diagnostics.text()
  expect(text).not.toContain('secret blocked payload')
  expect(JSON.parse(text)).toMatchObject({
    events: [{ causalChainId: firstMessage.id, fromAgentId: b.id, toAgentId: a.id }],
  })
})

test('a Team Policy denial returns its reason over HTTP and stores no message', async () => {
  const { createApp } = await import('../../src/app.ts')
  const {
    createProfile,
    messageRepo,
    providerModelRepo,
    providerStateRepo,
    registerTeam,
    spawnAgent,
    teamPolicyRepo,
  } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'a-team' }, ctx.paths)
  registerTeam(ctx.db, { id: 'b-team' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'a-team' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'b-team' })
  const app = createApp()
  const send = () =>
    app.request(`/api/agents/${b.id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: a.id, payload: { text: 'hello' } }),
    })

  const denied = await send()
  expect(denied.status).toBe(403)
  expect(await denied.json()).toMatchObject({
    code: 'communication_denied',
    error: expect.stringContaining('a-team'),
  })
  expect(messageRepo.listInbox(ctx.db, b.id)).toEqual([])

  teamPolicyRepo.update(ctx.db, 'a-team', { edges: [{ from: a.id, to: 'outside' }] })
  teamPolicyRepo.update(ctx.db, 'b-team', { edges: [{ from: 'outside', to: b.id }] })
  expect((await send()).status).toBe(201)
  expect(messageRepo.listInbox(ctx.db, b.id)).toHaveLength(1)
})
