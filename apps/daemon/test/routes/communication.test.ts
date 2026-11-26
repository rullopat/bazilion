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
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('over HTTP, a repeated message is refused payload-free, and an exchange is listed and stopped', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { createProfile, providerModelRepo, providerStateRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerTeam(ctx.db, { id: 'default' }, ctx.paths)
  const a = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const b = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'default' })
  const app = createApp()
  const auth = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  const send = (to: string, body: unknown) =>
    app.request(`/api/agents/${to}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(body),
    })

  const first = await send(b.id, { from: a.id, payload: { text: 'first payload' } })
  expect(first.status).toBe(201)
  const firstMessage = (await first.json()) as { id: string; causalChainId: string }
  expect(firstMessage.causalChainId).toBe(firstMessage.id)
  const again = { from: b.id, replyTo: firstMessage.id, payload: { text: 'secret payload' } }
  expect((await send(a.id, again)).status).toBe(201)
  const blocked = await send(a.id, again)
  expect(blocked.status).toBe(409)
  expect(((await blocked.json()) as { error: string }).error).toMatch(
    /^Not delivered: you already sent .+ this same message in this exchange/,
  )

  const diagnostics = await app.request(`/api/agents/${a.id}/loop-breaks`, { headers: auth })
  const text = await diagnostics.text()
  expect(text).not.toContain('secret payload')
  expect(JSON.parse(text)).toMatchObject({
    events: [
      {
        causalChainId: firstMessage.id,
        fromAgentId: b.id,
        toAgentId: a.id,
        step: 1,
        reason: 'repeated_message',
      },
    ],
  })

  const listed = await app.request('/api/teams/default/exchanges', { headers: auth })
  expect(await listed.json()).toMatchObject({
    exchanges: [{ id: firstMessage.id, agentIds: [a.id, b.id], messages: 2 }],
  })
  const stop = () =>
    app.request(`/api/exchanges/${firstMessage.id}/stop`, { method: 'POST', headers: auth })
  expect(await (await stop()).json()).toEqual({ stopped: true, cancelled: [], unread: 2 })
  expect(await (await stop()).json()).toEqual({ stopped: false, cancelled: [], unread: 0 })
  expect(
    (await app.request('/api/exchanges/no-such-exchange/stop', { method: 'POST', headers: auth }))
      .status,
  ).toBe(404)
  expect(
    await (await app.request('/api/teams/default/exchanges', { headers: auth })).json(),
  ).toEqual({ exchanges: [] })
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
