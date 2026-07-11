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
  home = mkdtempSync(join(tmpdir(), 'bazilion-harness-route-'))
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

test('legacy Profile Group HTTP is deprecated, revision-aware, and projects canonical reads', async () => {
  const { createProfile } = await import('../../src/core/index.ts')
  const { harnessTemplateRepo, liveHarnessRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { profileGroupsRouter } = await import('../../src/routes/profile-groups.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })

  const created = await profileGroupsRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'team', name: 'Team' }),
  })
  expect(created.status).toBe(201)
  expect(created.headers.get('deprecation')).toBe('true')
  expect(created.headers.get('sunset')).toBeTruthy()
  expect(created.headers.get('link')).toContain('/api/harness-templates')

  const stale = await profileGroupsRouter.request('/team/members', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"99"' },
    body: JSON.stringify({ members: [{ profileId: 'p', agentName: 'one' }] }),
  })
  expect(stale.status).toBe(409)
  expect((await stale.json()) as object).toMatchObject({ code: 'template_revision_conflict' })

  const saved = await profileGroupsRouter.request('/team/members', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"1"' },
    body: JSON.stringify({ members: [{ profileId: 'p', agentName: 'one' }] }),
  })
  expect(saved.status).toBe(200)

  const projected = await profileGroupsRouter.request('/team')
  expect(projected.status).toBe(200)
  expect(projected.headers.get('etag')).toBe('"2"')
  const projectedBody = (await projected.json()) as {
    group: { compatibilityManaged: boolean; revision: number }
    members: Array<{ slotId: string }>
  }
  expect(projectedBody.group).toMatchObject({
    compatibilityManaged: true,
    revision: 2,
  })
  expect(projectedBody.members[0]?.slotId).toMatch(/^[0-9a-f-]{36}$/)
  expect(harnessTemplateRepo.edges(ctx.db, 'team')).toHaveLength(4)

  const spawned = await profileGroupsRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'if-match': '"2"' },
    body: JSON.stringify({ groupSlug: 'spawned' }),
  })
  expect(spawned.status).toBe(200)
  expect(liveHarnessRepo.get(ctx.db, 'spawned')).toMatchObject({
    revision: 1,
    baselineInstantiationId: expect.any(String),
  })
  expect(liveHarnessRepo.bindings(ctx.db, 'spawned')).toHaveLength(1)

  const removed = await profileGroupsRouter.request('/team', {
    method: 'DELETE',
    headers: { 'if-match': '"2"' },
  })
  expect(removed.status).toBe(204)
  const tombstonedSpawn = await profileGroupsRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupSlug: 'again' }),
  })
  expect(tombstonedSpawn.status).toBe(410)
})

test('Profile defaults routes preserve omission and explicit null semantics', async () => {
  const { profilesRouter } = await import('../../src/routes/profiles.ts')
  const defaults = {
    userInput: true,
    userOutput: false,
    outsideGroupInput: true,
    outsideGroupOutput: false,
    peerDefault: 'inherit_harness',
  }
  const created = await profilesRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p', defaultModel: 'm', communicationDefaults: defaults }),
  })
  expect(created.status).toBe(201)
  const detail = await profilesRouter.request('/p')
  expect((await detail.json()) as object).toMatchObject({ communicationDefaults: defaults })

  await profilesRouter.request('/p', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'renamed' }),
  })
  const unchanged = await profilesRouter.request('/p')
  expect((await unchanged.json()) as object).toMatchObject({ communicationDefaults: defaults })

  await profilesRouter.request('/p', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ communicationDefaults: null }),
  })
  const cleared = (await (await profilesRouter.request('/p')).json()) as {
    communicationDefaults: unknown
  }
  expect(cleared.communicationDefaults).toBeNull()
})

test('legacy direct spawn rejects explicit Group policy with structured 409', async () => {
  const { createProfile, registerGroup } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const ctx = getCtx()
  const group = registerGroup(ctx.db, { id: 'explicit' }, ctx.paths)
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  ctx.db.raw.run("UPDATE live_harnesses SET membership_mode = 'explicit' WHERE group_id = ?", [
    group.id,
  ])
  const response = await agentsRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'p', groupId: group.id }),
  })
  expect(response.status).toBe(409)
  expect((await response.json()) as object).toMatchObject({ code: 'placement_required' })
})
