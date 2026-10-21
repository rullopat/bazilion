// T11 — Agent delete/archive/transfer browser ordering (D6). The canonical
// mutation must never leave a live browser or leak site state: deletion closes
// AND clears the profile before the agent row goes; transfer clears the
// profile (no site-state carryover); unresolved cleanup blocks the
// transition; a late failure after cleanup is reported honestly.

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

type FakeEntry = {
  agentId: string
  state: 'starting' | 'running' | 'stopping' | 'recovery_required'
  handle: { close: () => Promise<void> } | null
  posture: string
  lastUsedAt: number
  idleMs: number
  busy: number
  failure: { reasonCode: string; detail: string } | null
  close: () => Promise<void>
}

async function setup(): Promise<{
  agent: { id: string; teamId: string }
  revision: number
  installFakeSession: (opts?: { failClose?: boolean }) => { closed: () => boolean }
  slot: string
}> {
  const { createProfile, registerTeam, spawnAgent, teamPolicyRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resources } = await import('../../src/lib/resources.ts')
  const ctx = getCtx()
  const team = registerTeam(ctx.db, { id: 'g', name: 'team' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  const agent = spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: team.id })
  const policy = teamPolicyRepo.get(ctx.db, team.id)
  if (!policy) throw new Error('fixture policy missing')

  const slot = ctx.paths.browserDir(agent.id)
  const { claimBrowserProfile, clearOwnerMarker, readOwnerMarker } = await import(
    '../../src/lib/browser/profile.ts'
  )
  const installFakeSession = (opts?: { failClose?: boolean }) => {
    // Claim the slot for real: identity + owner marker exactly as a live
    // session would leave them. A successful close clears the marker (as the
    // real handle does once exit is proven); a failed close leaves it.
    claimBrowserProfile(ctx.paths, { agentId: agent.id, teamId: agent.teamId })
    let closed = false
    const entry: FakeEntry = {
      agentId: agent.id,
      state: 'running',
      handle: {
        close: async () => {
          if (opts?.failClose) throw new Error('browser close timed out (fixture)')
          clearOwnerMarker(slot)
          closed = true
        },
      },
      posture: 'test',
      lastUsedAt: Date.now(),
      idleMs: 900_000,
      busy: 0,
      failure: null,
      close: async () => {
        await entry.handle?.close()
      },
    }
    resources().browsers.set(agent.id, entry as never)
    return {
      closed: () => closed,
      marker: () => readOwnerMarker(slot),
    }
  }
  return { agent, revision: policy.revision, installFakeSession, slot }
}

test('DELETE closes the session and removes the profile BEFORE the canonical deletion', async () => {
  const { agentRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, revision, installFakeSession, slot } = await setup()
  const { resources } = await import('../../src/lib/resources.ts')

  const session = installFakeSession()

  const res = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=${revision}`, {
    method: 'DELETE',
  })
  expect(res.status).toBe(204)
  // D6: the session was retired through its handle before the row went away.
  expect(session.closed()).toBe(true)
  expect(existsSync(slot)).toBe(false)
  expect(resources().browsers.has(agent.id)).toBe(false)
  expect(agentRepo.get(getCtx().db, agent.id)).toBeNull()
})

test('DELETE with a stale revision is a 409 that does NOT cost the profile', async () => {
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, installFakeSession, slot } = await setup()

  const session = installFakeSession()

  const res = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=999999`, {
    method: 'DELETE',
  })
  expect(res.status).toBe(409)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe('team_revision_conflict')
  // The preflight refuses before any browser state is touched.
  expect(session.closed()).toBe(false)
  expect(existsSync(slot)).toBe(true)
})

test('DELETE with unresolved cleanup is blocked and the agent survives', async () => {
  const { agentRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, revision, installFakeSession, slot } = await setup()

  installFakeSession({ failClose: true })

  const res = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=${revision}`, {
    method: 'DELETE',
  })
  expect(res.status).toBe(409)
  const body = (await res.json()) as { code?: string; error?: string }
  expect(body.code).toBe('browser_recovery_required')
  // Nothing was lost and nothing leaked: the agent row stays, the slot stays.
  expect(agentRepo.get(getCtx().db, agent.id)).toBeTruthy()
  expect(existsSync(slot)).toBe(true)
})

test('DELETE reports a late failure after cleanup honestly, without claiming rollback', async () => {
  // Make the canonical mutation fail after the browser cleanup has won.
  vi.doMock('../../src/core/agent/delete.ts', () => ({
    deleteAgent: () => {
      throw new Error('team_revision_conflict: injected late failure')
    },
  }))
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, revision, installFakeSession, slot } = await setup()

  installFakeSession()

  const res = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=${revision}`, {
    method: 'DELETE',
  })
  expect(res.status).toBe(409)
  const body = (await res.json()) as { error?: string; warnings?: string[] }
  // The profile is gone (cleanup happened first, per D6) and the response says
  // so instead of pretending the mutation rolled the filesystem back.
  expect(existsSync(slot)).toBe(false)
  expect(body.warnings?.[0]).toMatch(/already removed and are not recovered/i)
})

test('ARCHIVE stops the browser first and preserves the profile', async () => {
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, installFakeSession, slot } = await setup()

  const session = installFakeSession()
  // Persistent profile state an archived agent keeps.
  writeFileSync(join(slot, 'profile-state.txt'), 'cookies-would-live-here')

  const res = await agentsRouter.request(`/${agent.id}/archive`, { method: 'POST' })
  expect(res.status).toBe(204)
  expect(session.closed()).toBe(true)
  // Archive preserves state (restore keeps the session usable).
  expect(existsSync(join(slot, 'profile-state.txt'))).toBe(true)
})

test('TRANSFER clears the profile (no site-state carryover) and the move succeeds', async () => {
  const { registerTeam } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, installFakeSession, slot } = await setup()
  const ctx = getCtx()
  const destination = registerTeam(ctx.db, { id: 'g2', name: 'team-2' }, ctx.paths)

  const session = installFakeSession()
  writeFileSync(join(slot, 'cookies.db'), 'site-state')

  const { teamPolicyRepo } = await import('../../src/core/index.ts')
  const sourceRevision = teamPolicyRepo.get(ctx.db, agent.teamId)?.revision
  const destinationRevision = teamPolicyRepo.get(ctx.db, destination.id)?.revision
  const res = await agentsRouter.request(`/${agent.id}/team`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: destination.id,
      sourceExpectedRevision: sourceRevision,
      destinationExpectedRevision: destinationRevision,
      placement: 'isolated',
    }),
  })
  expect(res.status).toBe(200)
  expect(session.closed()).toBe(true)
  // The slot is cleared for the new team — no account/site-state carryover.
  expect(existsSync(slot)).toBe(false)
})

test('TRANSFER with a stale source revision is a 409 that does NOT clear the profile', async () => {
  const { registerTeam } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { agent, installFakeSession, slot } = await setup()
  const ctx = getCtx()
  const destination = registerTeam(ctx.db, { id: 'g2', name: 'team-2' }, ctx.paths)

  const session = installFakeSession()

  const { teamPolicyRepo } = await import('../../src/core/index.ts')
  const destinationRevision = teamPolicyRepo.get(ctx.db, destination.id)?.revision
  const res = await agentsRouter.request(`/${agent.id}/team`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: destination.id,
      sourceExpectedRevision: 999999,
      destinationExpectedRevision: destinationRevision,
      placement: 'isolated',
    }),
  })
  expect(res.status).toBe(409)
  expect(session.closed()).toBe(false)
  expect(existsSync(slot)).toBe(true)
})
