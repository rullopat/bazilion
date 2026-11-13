// The managed-browser routes: status, stop, reset.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-agent-browser-route-'))
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

async function setupAgent() {
  const { createProfile, registerTeam, spawnAgent } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const team = registerTeam(ctx.db, { id: 'g', name: 'team' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })
  const { agentBrowserRouter } = await import('../../src/routes/agent-browser.ts')
  return { ctx, agent, agentBrowserRouter }
}

/** A running browser stand-in with a profile on disk. */
async function fakeSession(agentId: string) {
  const { resources } = await import('../../src/lib/resources.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const profile = getCtx().paths.browserDir(agentId)
  mkdirSync(join(profile, 'user-data'), { recursive: true })
  const state = { closed: false, profile }
  resources().browsers.set(agentId, {
    agentId,
    busy: 0,
    async close() {
      state.closed = true
      resources().browsers.delete(agentId)
    },
  } as never)
  return state
}

test('GET browser status reports without launching, by id or name', async () => {
  const { agent, agentBrowserRouter } = await setupAgent()
  const { resources } = await import('../../src/lib/resources.ts')
  for (const id of [agent.id, agent.name]) {
    const res = await agentBrowserRouter.request(`/${id}/browser`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      agentId: agent.id,
      enabled: true,
      running: false,
      profilePresent: false,
    })
  }
  expect(resources().browsers.size).toBe(0)
  expect((await agentBrowserRouter.request('/no-such-agent/browser')).status).toBe(404)
})

test('POST stop closes the browser and keeps the profile', async () => {
  const { agent, agentBrowserRouter } = await setupAgent()
  const session = await fakeSession(agent.id)
  const res = await agentBrowserRouter.request(`/${agent.id}/browser/stop`, { method: 'POST' })
  expect(res.status).toBe(204)
  expect(session.closed).toBe(true)
  expect(existsSync(session.profile)).toBe(true)
})

test('stop and reset refuse while the agent has a turn running', async () => {
  const { agent, agentBrowserRouter } = await setupAgent()
  const { registerAgent, unregisterAgent } = await import('../../src/lib/agent-cancel.ts')
  const session = await fakeSession(agent.id)
  registerAgent(agent.id, new AbortController())
  try {
    for (const [path, method] of [
      ['browser/stop', 'POST'],
      ['browser/profile', 'DELETE'],
    ] as const) {
      const res = await agentBrowserRouter.request(`/${agent.id}/${path}`, { method })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'agent_turn_active' })
    }
  } finally {
    unregisterAgent(agent.id)
  }
  expect(session.closed).toBe(false)
})

test('DELETE profile stops the browser and deletes the profile', async () => {
  const { agent, agentBrowserRouter } = await setupAgent()
  const session = await fakeSession(agent.id)
  const res = await agentBrowserRouter.request(`/${agent.id}/browser/profile`, { method: 'DELETE' })
  expect(res.status).toBe(204)
  expect(session.closed).toBe(true)
  expect(existsSync(session.profile)).toBe(false)
  expect(
    (await agentBrowserRouter.request('/no-such-agent/browser/profile', { method: 'DELETE' }))
      .status,
  ).toBe(404)
})
