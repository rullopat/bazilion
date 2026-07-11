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
  home = mkdtempSync(join(tmpdir(), 'bazilion-harness-template-route-'))
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

test('canonical template routes preserve stable slots, snapshots, and clone independence', async () => {
  const { createProfile, harnessTemplateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { harnessTemplatesRouter } = await import('../../src/routes/harness-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })

  const created = await harnessTemplatesRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'team', name: 'Team' }),
  })
  expect(created.status).toBe(201)
  expect((await created.json()) as object).toMatchObject({
    template: { currentRevision: 1, compatibilityManaged: false },
    slots: [],
  })

  const defined = await harnessTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      slots: [
        { profileId: 'p', agentName: 'one' },
        { profileId: 'p', agentName: 'two' },
      ],
      edges: [],
    }),
  })
  expect(defined.status).toBe(200)
  const body = (await defined.json()) as {
    template: { currentRevision: number }
    slots: Array<{ slotId: string; agentName: string }>
  }
  const [one, two] = body.slots
  expect(one?.slotId).toMatch(/^[0-9a-f-]{36}$/)
  expect(two?.slotId).toMatch(/^[0-9a-f-]{36}$/)

  const reordered = await harnessTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 2,
      slots: [
        { slotId: two?.slotId, profileId: 'p', agentName: 'two edited' },
        { slotId: one?.slotId, profileId: 'p', agentName: 'one' },
      ],
      edges: [
        { sourceKind: 'slot', sourceId: one?.slotId, targetKind: 'slot', targetId: two?.slotId },
      ],
    }),
  })
  expect(reordered.status).toBe(200)
  expect(harnessTemplateRepo.revision(ctx.db, 'team', 2)?.slots.map((slot) => slot.slotId)).toEqual(
    [one?.slotId, two?.slotId],
  )
  expect(harnessTemplateRepo.revision(ctx.db, 'team', 3)?.slots.map((slot) => slot.slotId)).toEqual(
    [two?.slotId, one?.slotId],
  )

  const stale = await harnessTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, slots: [], edges: [] }),
  })
  expect(stale.status).toBe(409)
  expect((await stale.json()) as object).toMatchObject({
    code: 'template_revision_conflict',
    currentRevision: 3,
  })

  const cloned = await harnessTemplatesRouter.request('/team/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateExpectedRevision: 3, id: 'copy' }),
  })
  expect(cloned.status).toBe(201)
  const cloneBody = (await cloned.json()) as {
    template: { currentRevision: number }
    slots: Array<{ slotId: string }>
    edges: Array<{ sourceId: string; targetId: string }>
  }
  expect(cloneBody.template.currentRevision).toBe(1)
  expect(cloneBody.slots.map((slot) => slot.slotId)).not.toEqual(
    body.slots.map((slot) => slot.slotId),
  )
  expect(cloneBody.edges).toHaveLength(1)
})

test('canonical routes are authenticated through the daemon app and return resolved aggregates', async () => {
  const { providerModelRepo, providerStateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { createApp } = await import('../../src/app.ts')
  const ctx = getCtx()
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  const app = createApp()

  const unauthorized = await app.request('/api/harness-templates')
  expect(unauthorized.status).toBe(401)

  const created = await app.request('/api/harness-templates', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id: 'team', name: 'Team' }),
  })
  expect(created.status).toBe(201)
  expect((await created.json()) as object).toMatchObject({
    template: { id: 'team', currentRevision: 1 },
    slots: [],
    edges: [],
    currentSnapshot: { templateId: 'team', revision: 1 },
  })
})

test('canonical definition validates edge domains and never mutates on failure', async () => {
  const { createProfile, harnessTemplateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { harnessTemplatesRouter } = await import('../../src/routes/harness-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  harnessTemplateRepo.insertCanonical(ctx.db, { id: 'team', name: 'Team' })

  const invalid = await harnessTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      slots: [{ slotId: 'stable', profileId: 'p', agentName: 'one' }],
      edges: [{ sourceKind: 'user', targetKind: 'outside_group' }],
    }),
  })
  expect(invalid.status).toBe(400)
  expect(harnessTemplateRepo.get(ctx.db, 'team')?.currentRevision).toBe(1)
  expect(harnessTemplateRepo.slots(ctx.db, 'team')).toEqual([])
})

test('Group policy replacement and canonical direct spawn are revisioned and permanently explicit', async () => {
  const { createProfile, liveHarnessRepo, registerGroup } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { groupsRouter } = await import('../../src/routes/groups.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerGroup(ctx.db, { id: 'g' }, ctx.paths)

  const spawned = await agentsRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: 'p',
      groupId: 'g',
      groupExpectedRevision: 1,
      placement: 'isolated',
    }),
  })
  expect(spawned.status).toBe(201)
  const spawnedBody = (await spawned.json()) as { agent: { id: string } }
  const agent = spawnedBody.agent
  expect(liveHarnessRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 2,
    membershipMode: 'explicit',
  })
  expect(liveHarnessRepo.edges(ctx.db, 'g')).toEqual([])

  const saved = await groupsRouter.request('/g/harness/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 2,
      edges: [
        { sourceKind: 'user', targetKind: 'agent', targetId: agent.id },
        { sourceKind: 'agent', sourceId: agent.id, targetKind: 'user' },
      ],
    }),
  })
  expect(saved.status).toBe(200)
  expect((await saved.json()) as object).toMatchObject({
    harness: { revision: 3, membershipMode: 'explicit' },
    edges: expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'user', targetId: agent.id }),
    ]),
  })

  const stale = await groupsRouter.request('/g/harness/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, edges: [] }),
  })
  expect(stale.status).toBe(409)
  expect(liveHarnessRepo.get(ctx.db, 'g')?.revision).toBe(3)

  const invalid = await groupsRouter.request('/g/harness/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 3,
      edges: [{ sourceKind: 'agent', sourceId: 'not-a-member', targetKind: 'user' }],
    }),
  })
  expect(invalid.status).toBe(400)
  expect((await invalid.json()) as object).toMatchObject({ code: 'member_not_in_group' })
  expect(liveHarnessRepo.get(ctx.db, 'g')?.revision).toBe(3)
})

test('reviewed Team spawn initializes revision one and append preserves baseline without cross-cohort peers', async () => {
  const { createProfile, harnessTemplateRepo, liveHarnessRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { harnessTemplatesRouter } = await import('../../src/routes/harness-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  harnessTemplateRepo.insertCanonical(ctx.db, { id: 'team', name: 'Team', userMd: 'starter' })
  harnessTemplateRepo.replaceCanonicalDefinition(ctx.db, 'team', {
    expectedRevision: 1,
    slots: [
      { clientKey: 'one', profileId: 'p', agentName: 'one' },
      { clientKey: 'two', profileId: 'p', agentName: 'two' },
    ],
    edges: [
      { sourceKind: 'slot', sourceId: 'one', targetKind: 'slot', targetId: 'two' },
      { sourceKind: 'user', targetKind: 'slot', targetId: 'one' },
    ],
  })

  const initialized = await harnessTemplatesRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      groupId: 'new-team',
      mode: 'initialize',
    }),
  })
  expect(initialized.status).toBe(201)
  const first = (await initialized.json()) as {
    agents: Array<{ id: string }>
    group: {
      harness: { revision: number; membershipMode: string; baselineInstantiationId: string }
    }
  }
  expect(first.group.harness).toMatchObject({ revision: 1, membershipMode: 'explicit' })
  expect(first.group.harness.baselineInstantiationId).toEqual(expect.any(String))
  expect(liveHarnessRepo.bindings(ctx.db, 'new-team')).toHaveLength(2)
  expect(liveHarnessRepo.edges(ctx.db, 'new-team')).toHaveLength(2)

  const appended = await harnessTemplatesRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      groupId: 'new-team',
      groupExpectedRevision: 1,
      mode: 'append',
    }),
  })
  expect(appended.status).toBe(201)
  const second = (await appended.json()) as { agents: Array<{ id: string }> }
  expect(liveHarnessRepo.get(ctx.db, 'new-team')).toMatchObject({
    revision: 2,
    baselineInstantiationId: first.group.harness.baselineInstantiationId,
  })
  expect(liveHarnessRepo.instantiations(ctx.db, 'new-team')).toHaveLength(2)
  expect(liveHarnessRepo.bindings(ctx.db, 'new-team')).toHaveLength(4)
  const edges = liveHarnessRepo.edges(ctx.db, 'new-team')
  expect(edges).toHaveLength(4)
  expect(
    edges.some(
      (edge) =>
        first.agents.some((agent) => agent.id === edge.sourceId) &&
        second.agents.some((agent) => agent.id === edge.targetId),
    ),
  ).toBe(false)
})

test('adoption requires reviewed total mapping and preview, then save-as-template leaves live revision unchanged', async () => {
  const { createProfile, harnessTemplateRepo, liveHarnessRepo, registerGroup, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { groupsRouter } = await import('../../src/routes/groups.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerGroup(ctx.db, { id: 'g' }, ctx.paths)
  const mapped = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    groupId: 'g',
    groupExpectedRevision: 1,
    placement: 'isolated',
  })
  const remaining = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    groupId: 'g',
    groupExpectedRevision: 2,
    placement: 'isolated',
  })
  harnessTemplateRepo.insertCanonicalDefinition(ctx.db, {
    id: 'source',
    name: 'Source',
    slots: [{ slotId: 'slot', profileId: 'p', agentName: 'mapped' }],
    edges: [{ sourceKind: 'user', targetKind: 'slot', targetId: 'slot' }],
  })
  const previewEdges = [
    { sourceKind: 'user', sourceId: null, targetKind: 'agent', targetId: mapped.id },
    { sourceKind: 'user', sourceId: null, targetKind: 'agent', targetId: remaining.id },
    { sourceKind: 'agent', sourceId: remaining.id, targetKind: 'user', targetId: null },
    {
      sourceKind: 'outside_group',
      sourceId: null,
      targetKind: 'agent',
      targetId: remaining.id,
    },
    {
      sourceKind: 'agent',
      sourceId: remaining.id,
      targetKind: 'outside_group',
      targetId: null,
    },
    { sourceKind: 'agent', sourceId: remaining.id, targetKind: 'agent', targetId: mapped.id },
    { sourceKind: 'agent', sourceId: mapped.id, targetKind: 'agent', targetId: remaining.id },
  ]
  const adopted = await groupsRouter.request('/g/harness/adopt-template', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groupExpectedRevision: 3,
      templateId: 'source',
      templateExpectedRevision: 1,
      slotMappings: [{ slotId: 'slot', agentId: mapped.id }],
      remainingPlacements: [{ agentId: remaining.id, placement: 'open' }],
      previewEdges,
    }),
  })
  expect(adopted.status).toBe(200)
  expect(liveHarnessRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 4,
    membershipMode: 'explicit',
  })
  expect(liveHarnessRepo.bindings(ctx.db, 'g')).toEqual([
    expect.objectContaining({ agentId: mapped.id, sourceSlotId: 'slot' }),
  ])
  expect(liveHarnessRepo.edges(ctx.db, 'g')).toHaveLength(previewEdges.length)

  const saved = await groupsRouter.request('/g/harness/save-as-template', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 4, id: 'saved', name: 'Saved' }),
  })
  expect(saved.status).toBe(201)
  expect((await saved.json()) as object).toMatchObject({
    template: { currentRevision: 1, compatibilityManaged: false },
    slots: [{ profileId: 'p' }, { profileId: 'p' }],
  })
  expect(liveHarnessRepo.get(ctx.db, 'g')?.revision).toBe(4)
  expect(harnessTemplateRepo.edges(ctx.db, 'saved')).toHaveLength(previewEdges.length)
})

test('update-source transfers selected cohort bindings, prunes only emptied cohort, and preserves live edges', async () => {
  const { createProfile, harnessTemplateRepo, liveHarnessRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { groupsRouter } = await import('../../src/routes/groups.ts')
  const { harnessTemplatesRouter } = await import('../../src/routes/harness-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  harnessTemplateRepo.insertCanonicalDefinition(ctx.db, {
    id: 'source',
    name: 'Source',
    slots: [{ slotId: 'slot', profileId: 'p', agentName: 'one' }],
    edges: [{ sourceKind: 'user', targetKind: 'slot', targetId: 'slot' }],
  })
  await harnessTemplatesRouter.request('/source/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 1,
      groupId: 'g',
      mode: 'initialize',
    }),
  })
  const appendResponse = await harnessTemplatesRouter.request('/source/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 1,
      groupId: 'g',
      groupExpectedRevision: 1,
      mode: 'append',
    }),
  })
  const appended = (await appendResponse.json()) as { agents: Array<{ id: string }> }
  const beforeEdges = liveHarnessRepo.edges(ctx.db, 'g')
  const beforeBaseline = liveHarnessRepo.get(ctx.db, 'g')?.baselineInstantiationId

  const updated = await groupsRouter.request('/g/harness/update-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groupExpectedRevision: 2,
      templateExpectedRevision: 1,
      includeAgentIds: appended.agents.map((agent) => agent.id),
    }),
  })
  expect(updated.status).toBe(200)
  expect(harnessTemplateRepo.get(ctx.db, 'source')?.currentRevision).toBe(2)
  expect(liveHarnessRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 3,
    baselineInstantiationId: beforeBaseline,
  })
  expect(liveHarnessRepo.edges(ctx.db, 'g')).toEqual(beforeEdges)
  expect(liveHarnessRepo.instantiations(ctx.db, 'g')).toHaveLength(1)
  expect(liveHarnessRepo.bindings(ctx.db, 'g')).toHaveLength(2)
  expect(
    liveHarnessRepo
      .bindings(ctx.db, 'g')
      .every((binding) => binding.instantiationId === beforeBaseline),
  ).toBe(true)

  harnessTemplateRepo.updateCanonicalMetadata(ctx.db, 'source', {
    expectedRevision: 2,
    name: 'diverged',
  })
  const diverged = await groupsRouter.request('/g/harness/update-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groupExpectedRevision: 3,
      templateExpectedRevision: 3,
      includeAgentIds: [],
    }),
  })
  expect(diverged.status).toBe(409)
  expect((await diverged.json()) as object).toMatchObject({ code: 'source_diverged' })
  expect(liveHarnessRepo.get(ctx.db, 'g')?.revision).toBe(3)
})

test('canonical move and delete update both explicit Groups exactly once through permanent Agent URLs', async () => {
  const { createProfile, liveHarnessRepo, registerGroup, spawnAgent } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { groupsRouter } = await import('../../src/routes/groups.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  registerGroup(ctx.db, { id: 'source' }, ctx.paths)
  registerGroup(ctx.db, { id: 'destination' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    groupId: 'source',
    groupExpectedRevision: 1,
    placement: 'open',
  })

  const moved = await agentsRouter.request(`/${agent.id}/group`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groupId: 'destination',
      sourceExpectedRevision: 2,
      destinationExpectedRevision: 1,
      placement: 'isolated',
    }),
  })
  expect(moved.status).toBe(200)
  expect(liveHarnessRepo.get(ctx.db, 'source')).toMatchObject({
    revision: 3,
    membershipMode: 'explicit',
  })
  expect(liveHarnessRepo.get(ctx.db, 'destination')).toMatchObject({
    revision: 2,
    membershipMode: 'explicit',
  })
  expect(liveHarnessRepo.edges(ctx.db, 'source')).toEqual([])
  expect(liveHarnessRepo.edges(ctx.db, 'destination')).toEqual([])

  const staleDelete = await agentsRouter.request(`/${agent.id}?expectedGroupRevision=1`, {
    method: 'DELETE',
  })
  expect(staleDelete.status).toBe(409)
  expect(liveHarnessRepo.get(ctx.db, 'destination')?.revision).toBe(2)

  const deleted = await agentsRouter.request(`/${agent.id}?expectedGroupRevision=2`, {
    method: 'DELETE',
  })
  expect(deleted.status).toBe(204)
  expect(liveHarnessRepo.get(ctx.db, 'destination')).toMatchObject({
    revision: 3,
    membershipMode: 'explicit',
  })

  const deletedGroup = await groupsRouter.request('/destination?expectedHarnessRevision=3', {
    method: 'DELETE',
  })
  expect(deletedGroup.status).toBe(204)
  expect(liveHarnessRepo.get(ctx.db, 'destination')).toBeNull()
})
