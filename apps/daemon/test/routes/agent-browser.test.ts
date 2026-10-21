// T13 — status/stop/reset HTTP routes (BAZ-069 D6). Read/write scope
// separation, session CSRF, alias-to-canonical id resolution, active-turn and
// busy refusal, failed-cleanup refusals, and sanitized diagnostics (no raw
// child stderr, no profile/home paths in API errors).

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
  return { ctx, agent }
}

/** Install a fake running session with a realistic claimed slot. */
async function installFakeSession(agentId: string, teamId: string, failClose = false) {
  const { resources } = await import('../../src/lib/resources.ts')
  const { claimBrowserProfile, clearOwnerMarker } = await import('../../src/lib/browser/profile.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const slot = ctx.paths.browserDir(agentId)
  claimBrowserProfile(ctx.paths, { agentId, teamId })
  let closed = false
  resources().browsers.set(agentId, {
    agentId,
    state: 'running',
    handle: {
      close: async () => {
        if (failClose) throw new Error('browser close timed out (fixture): child stderr content')
        clearOwnerMarker(slot)
        closed = true
      },
    },
    posture: 'test',
    lastUsedAt: Date.now(),
    idleMs: 900_000,
    busy: 0,
    failure: null,
    close: async () => {},
  } as never)
  return { slot, closed: () => closed }
}

test('GET search readiness is shared alias-safe configuration, never a provider probe', async () => {
  const { agent, ctx } = await setupAgent()
  const { openConfig, openSecrets } = await import('../../src/core/index.ts')
  openConfig(ctx.db).set('BAZILION_WEB_SEARCH_ROUTE', 'brave')
  openSecrets(ctx.db, ctx.authToken).set('BRAVE_API_KEY', 'synthetic-readiness-key')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const fetcher = vi.spyOn(globalThis, 'fetch')
  for (const id of [agent.id, agent.name]) {
    const res = await agentsRouter.request(`/${id}/search-status`)
    expect(res.status).toBe(200)
    const status = await res.json()
    expect(status).toMatchObject({ state: 'configured', route: 'brave', account: 'managed' })
    expect(JSON.stringify(status)).not.toContain('synthetic-readiness-key')
  }
  expect(fetcher).not.toHaveBeenCalled()
  fetcher.mockRestore()
  const missing = await agentsRouter.request('/missing/search-status')
  expect(missing.status).toBe(404)
})

test('GET browser status reports facts without launching (stopped agent, no slot)', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { resources } = await import('../../src/lib/resources.ts')

  const res = await agentsRouter.request(`/${agent.id}/browser`)
  expect(res.status).toBe(200)
  const status = (await res.json()) as Record<string, unknown>
  expect(status.agentId).toBe(agent.id)
  expect(status.enabled).toBe(true)
  expect(status.state).toBe('stopped')
  expect(status.profilePresent).toBe(false)
  // This machine has a discoverable browser; availability is a config fact.
  expect(['configured', 'unavailable']).toContain(status.availability)
  // Nothing was created: status never launches.
  expect(resources().browsers.size).toBe(0)
})

test('GET browser status resolves an alias to the canonical id', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')

  const res = await agentsRouter.request(`/${agent.name}/browser`)
  expect(res.status).toBe(200)
  const status = (await res.json()) as Record<string, unknown>
  // The wire shape always names the canonical id.
  expect(status.agentId).toBe(agent.id)
})

test('GET browser status for an unknown agent is 404', async () => {
  await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const res = await agentsRouter.request('/no-such-agent/browser')
  expect(res.status).toBe(404)
})

test('GET browser status sanitizes failure diagnostics (no raw stderr, no paths)', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { resources } = await import('../../src/lib/resources.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const slot = ctx.paths.browserDir(agent.id)
  await installFakeSession(agent.id, agent.teamId)
  resources().browsers.set(agent.id, {
    ...resources().browsers.get(agent.id),
    state: 'recovery_required',
    failure: {
      reasonCode: 'browser_recovery_required',
      detail: `launch failed: CHILD_STDERR_SENTINEL\nLD_LIBRARY_PATH=${slot}\nmore stderr`,
    },
  } as never)

  const res = await agentsRouter.request(`/${agent.id}/browser`)
  expect(res.status).toBe(200)
  const status = (await res.json()) as { reasonCode?: string; remedy?: string }
  expect(status.reasonCode).toBe('browser_recovery_required')
  expect(status.remedy).toBeDefined()
  // No raw child stderr, no slot/home paths, single line, bounded.
  expect(status.remedy).not.toContain(slot)
  expect(status.remedy).not.toContain('CHILD_STDERR_SENTINEL')
  expect(status.remedy).not.toContain('\n')
  expect(status.remedy!.length).toBeLessThanOrEqual(240)
})

test('POST stop retires the session and PRESERVES the profile', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { resources } = await import('../../src/lib/resources.ts')
  const session = await installFakeSession(agent.id, agent.teamId)

  const res = await agentsRouter.request(`/${agent.id}/browser/stop`, { method: 'POST' })
  expect(res.status).toBe(204)
  expect(session.closed()).toBe(true)
  expect(resources().browsers.has(agent.id)).toBe(false)
  // Persistent state survives a stop.
  expect(await import('node:fs')).toBeTruthy()
  const { existsSync } = await import('node:fs')
  expect(existsSync(session.slot)).toBe(true)
})

test('POST stop on a busy session is 409 with a code', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { resources } = await import('../../src/lib/resources.ts')
  await installFakeSession(agent.id, agent.teamId)
  const entry = resources().browsers.get(agent.id)!
  entry.busy = 1

  const res = await agentsRouter.request(`/${agent.id}/browser/stop`, { method: 'POST' })
  expect(res.status).toBe(409)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe('browser_busy')
  // The busy session was not touched.
  expect(resources().browsers.has(agent.id)).toBe(true)
})

test('DELETE profile reset requires an explicit confirmation (400 otherwise)', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  await installFakeSession(agent.id, agent.teamId)

  const res = await agentsRouter.request(`/${agent.id}/browser/profile`, { method: 'DELETE' })
  expect(res.status).toBe(400)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe('confirmation_required')
})

test('DELETE profile reset (confirmed) stops and removes the slot', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const session = await installFakeSession(agent.id, agent.teamId)

  const res = await agentsRouter.request(
    `/${agent.id}/browser/profile?confirm=reset-browser-profile`,
    {
      method: 'DELETE',
    },
  )
  expect(res.status).toBe(204)
  expect(session.closed()).toBe(true)
  const { existsSync } = await import('node:fs')
  expect(existsSync(session.slot)).toBe(false)
})

test('DELETE profile reset with unresolved cleanup is a 409 that resets nothing silently', async () => {
  const { agent } = await setupAgent()
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  await installFakeSession(agent.id, agent.teamId, true) // close will fail

  const res = await agentsRouter.request(
    `/${agent.id}/browser/profile?confirm=reset-browser-profile`,
    {
      method: 'DELETE',
    },
  )
  expect(res.status).toBe(409)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe('browser_recovery_required')
  // The uncertain browser is not silently reset: the slot remains for
  // operator reconciliation.
  const { existsSync } = await import('node:fs')
  expect(
    existsSync((await import('../../src/lib/ctx.ts')).getCtx().paths.browserDir(agent.id)),
  ).toBe(true)
})

test('browser control routes follow the read/write scope defaults', async () => {
  const { requiredScope } = await import('../../src/lib/scopes.ts')
  expect(requiredScope('GET', '/api/agents/x/browser')).toBe('read')
  expect(requiredScope('POST', '/api/agents/x/browser/stop')).toBe('write')
  expect(requiredScope('DELETE', '/api/agents/x/browser/profile')).toBe('write')
})
