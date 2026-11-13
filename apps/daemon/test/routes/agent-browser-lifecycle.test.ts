// What Agent delete, archive and Team moves do to the agent's browser:
// delete removes the profile after the agent is gone, archive stops the browser
// and keeps the profile, and a moved agent keeps both.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-browser-lifecycle-route-'))
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

/** An agent whose browser is running, with cookies in its profile. */
async function setup() {
  const { agentRepo, createProfile, registerTeam, spawnAgent } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resources } = await import('../../src/lib/resources.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const ctx = getCtx()
  const team = registerTeam(ctx.db, { id: 'g', name: 'team' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })
  const cookies = join(ctx.paths.browserDir(agent.id), 'user-data', 'Cookies')
  mkdirSync(join(cookies, '..'), { recursive: true })
  writeFileSync(cookies, 'site-state')
  const browser = { closed: false }
  resources().browsers.set(agent.id, {
    agentId: agent.id,
    busy: 0,
    async close() {
      browser.closed = true
      resources().browsers.delete(agent.id)
    },
  } as never)
  return { ctx, agent, agentRepo, registerTeam, agentsRouter, browser, cookies }
}

test('deleting an agent closes its browser and removes the profile', async () => {
  const { ctx, agent, agentRepo, agentsRouter, browser } = await setup()
  const res = await agentsRouter.request(`/${agent.id}`, { method: 'DELETE' })
  expect(res.status).toBe(204)
  expect(agentRepo.get(ctx.db, agent.id)).toBeNull()
  expect(browser.closed).toBe(true)
  expect(existsSync(ctx.paths.browserDir(agent.id))).toBe(false)
})

test('archiving stops the browser and keeps the profile', async () => {
  const { agent, agentsRouter, browser, cookies } = await setup()
  const res = await agentsRouter.request(`/${agent.id}/archive`, { method: 'POST' })
  expect(res.status).toBe(204)
  expect(browser.closed).toBe(true)
  expect(existsSync(cookies)).toBe(true)
})

test('a moved agent keeps its browser and its profile', async () => {
  const { ctx, agent, agentsRouter, browser, cookies, registerTeam } = await setup()
  const destination = registerTeam(ctx.db, { id: 'g2', name: 'team-2' }, ctx.paths)
  const res = await agentsRouter.request(`/${agent.id}/team`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: destination.id }),
  })
  expect(res.status).toBe(200)
  expect(browser.closed).toBe(false)
  expect(existsSync(cookies)).toBe(true)
})
