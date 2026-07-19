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
  home = mkdtempSync(join(tmpdir(), 'bazilion-teamPolicy-template-route-'))
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
  const { createProfile, teamTemplateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamTemplatesRouter } = await import('../../src/routes/team-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })

  const created = await teamTemplatesRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'team', name: 'Team' }),
  })
  expect(created.status).toBe(201)
  expect((await created.json()) as object).toMatchObject({
    template: { currentRevision: 1 },
    slots: [],
  })

  const defined = await teamTemplatesRouter.request('/team/definition', {
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

  const reordered = await teamTemplatesRouter.request('/team/definition', {
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
  expect(teamTemplateRepo.revision(ctx.db, 'team', 2)?.slots.map((slot) => slot.slotId)).toEqual([
    one?.slotId,
    two?.slotId,
  ])
  expect(teamTemplateRepo.revision(ctx.db, 'team', 3)?.slots.map((slot) => slot.slotId)).toEqual([
    two?.slotId,
    one?.slotId,
  ])

  const stale = await teamTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, slots: [], edges: [] }),
  })
  expect(stale.status).toBe(409)
  expect((await stale.json()) as object).toMatchObject({
    code: 'template_revision_conflict',
    currentRevision: 3,
  })

  const cloned = await teamTemplatesRouter.request('/team/clone', {
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

test('reviewed prototype import allocates server slot ids and translates edges atomically', async () => {
  const { createProfile, teamTemplateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamTemplatesRouter } = await import('../../src/routes/team-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })

  const imported = await teamTemplatesRouter.request('/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'imported',
      name: 'Imported',
      slots: [
        { clientKey: 'prototype-a', profileId: 'p', agentName: 'one' },
        { clientKey: 'prototype-b', profileId: 'p', agentName: 'two' },
      ],
      edges: [
        {
          sourceKind: 'slot',
          sourceId: 'prototype-a',
          targetKind: 'slot',
          targetId: 'prototype-b',
        },
      ],
    }),
  })
  expect(imported.status).toBe(201)
  const body = (await imported.json()) as {
    slots: Array<{ slotId: string }>
    edges: Array<{ sourceId: string; targetId: string }>
  }
  expect(body.slots).toHaveLength(2)
  expect(body.slots.map((slot) => slot.slotId)).not.toContain('prototype-a')
  expect(body.edges).toEqual([
    expect.objectContaining({
      sourceId: body.slots[0]?.slotId,
      targetId: body.slots[1]?.slotId,
    }),
  ])

  const invalid = await teamTemplatesRouter.request('/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'broken-import',
      name: 'Broken',
      slots: [{ clientKey: 'prototype-a', profileId: 'p', agentName: 'one' }],
      edges: [{ sourceKind: 'slot', sourceId: 'missing', targetKind: 'user' }],
    }),
  })
  expect(invalid.status).toBe(400)
  expect(teamTemplateRepo.get(ctx.db, 'broken-import')).toBeNull()
})

test('canonical routes are authenticated through the daemon app and return resolved aggregates', async () => {
  const { providerModelRepo, providerStateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { createApp } = await import('../../src/app.ts')
  const ctx = getCtx()
  providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  const app = createApp()

  const unauthorized = await app.request('/api/team-templates')
  expect(unauthorized.status).toBe(401)

  const created = await app.request('/api/team-templates', {
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
  const { createProfile, teamTemplateRepo } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamTemplatesRouter } = await import('../../src/routes/team-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  teamTemplateRepo.insertCanonical(ctx.db, { id: 'team', name: 'Team' })

  const invalid = await teamTemplatesRouter.request('/team/definition', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      slots: [{ slotId: 'stable', profileId: 'p', agentName: 'one' }],
      edges: [{ sourceKind: 'user', targetKind: 'outside_team' }],
    }),
  })
  expect(invalid.status).toBe(400)
  expect(teamTemplateRepo.get(ctx.db, 'team')?.currentRevision).toBe(1)
  expect(teamTemplateRepo.slots(ctx.db, 'team')).toEqual([])
})

test('Team policy replacement and canonical direct spawn are revisioned and permanently explicit', async () => {
  const { createProfile, teamPolicyRepo, registerTeam } = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, {
    id: 'p',
    defaultModel: 'm',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  registerTeam(ctx.db, { id: 'g' }, ctx.paths)

  const removedOpenPlacement = await agentsRouter.request('/placement-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: 'p',
      teamId: 'g',
      teamExpectedRevision: 1,
      placement: 'open',
    }),
  })
  expect(removedOpenPlacement.status).toBe(400)

  const placementPreview = await agentsRouter.request('/placement-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: 'p',
      teamId: 'g',
      teamExpectedRevision: 1,
      placement: 'profile_defaults',
    }),
  })
  expect(placementPreview.status).toBe(200)
  expect((await placementPreview.json()) as object).toMatchObject({
    currentRevision: 1,
    resultingRevision: 2,
    symbolicAgentId: 'new-agent',
    existingEdges: [],
    addedEdges: expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'user', targetId: 'new-agent' }),
      expect.objectContaining({ sourceId: 'new-agent', targetKind: 'user' }),
    ]),
  })

  const spawned = await agentsRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: 'p',
      teamId: 'g',
      teamExpectedRevision: 1,
      placement: 'isolated',
    }),
  })
  expect(spawned.status).toBe(201)
  const spawnedBody = (await spawned.json()) as { agent: { id: string } }
  const agent = spawnedBody.agent
  expect(teamPolicyRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 2,
  })
  expect(teamPolicyRepo.edges(ctx.db, 'g')).toEqual([])

  const saved = await teamsRouter.request('/g/policy', {
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
    teamPolicy: { revision: 3 },
    edges: expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'user', targetId: agent.id }),
    ]),
  })

  const stale = await teamsRouter.request('/g/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, edges: [] }),
  })
  expect(stale.status).toBe(409)
  expect(teamPolicyRepo.get(ctx.db, 'g')?.revision).toBe(3)

  const invalid = await teamsRouter.request('/g/policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 3,
      edges: [{ sourceKind: 'agent', sourceId: 'not-a-member', targetKind: 'user' }],
    }),
  })
  expect(invalid.status).toBe(400)
  expect((await invalid.json()) as object).toMatchObject({ code: 'member_not_in_group' })
  expect(teamPolicyRepo.get(ctx.db, 'g')?.revision).toBe(3)
})

test('reviewed Team spawn initializes revision one and append preserves baseline without cross-cohort peers', async () => {
  const { createProfile, teamTemplateRepo, teamPolicyRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamTemplatesRouter } = await import('../../src/routes/team-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  teamTemplateRepo.insertCanonical(ctx.db, { id: 'team', name: 'Team', userMd: 'starter' })
  teamTemplateRepo.replaceCanonicalDefinition(ctx.db, 'team', {
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

  const initializePreview = await teamTemplatesRouter.request('/team/spawn/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      teamId: 'new-team',
      mode: 'initialize',
    }),
  })
  expect(initializePreview.status).toBe(200)
  expect((await initializePreview.json()) as object).toMatchObject({
    mode: 'initialize',
    currentRevision: null,
    resultingRevision: 1,
    newMembers: [{ agentName: 'one' }, { agentName: 'two' }],
    edges: [
      expect.objectContaining({ sourceId: expect.stringMatching(/^new:/) }),
      expect.objectContaining({ targetId: expect.stringMatching(/^new:/) }),
    ],
  })

  const initialized = await teamTemplatesRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      teamId: 'new-team',
      mode: 'initialize',
    }),
  })
  expect(initialized.status).toBe(201)
  const first = (await initialized.json()) as {
    agents: Array<{ id: string }>
    team: {
      teamPolicy: { revision: number; baselineInstantiationId: string }
    }
  }
  expect(first.team.teamPolicy).toMatchObject({ revision: 1 })
  expect(first.team.teamPolicy.baselineInstantiationId).toEqual(expect.any(String))
  expect(teamPolicyRepo.bindings(ctx.db, 'new-team')).toHaveLength(2)
  expect(teamPolicyRepo.edges(ctx.db, 'new-team')).toHaveLength(2)

  const appendPreview = await teamTemplatesRouter.request('/team/spawn/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      teamId: 'new-team',
      teamExpectedRevision: 1,
      mode: 'append',
    }),
  })
  expect(appendPreview.status).toBe(200)
  expect((await appendPreview.json()) as object).toMatchObject({
    mode: 'append',
    currentRevision: 1,
    resultingRevision: 2,
    edges: expect.arrayContaining([
      expect.objectContaining({ sourceId: expect.stringMatching(/^new:/) }),
    ]),
  })

  const appended = await teamTemplatesRouter.request('/team/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 2,
      teamId: 'new-team',
      teamExpectedRevision: 1,
      mode: 'append',
    }),
  })
  expect(appended.status).toBe(201)
  const second = (await appended.json()) as { agents: Array<{ id: string }> }
  expect(teamPolicyRepo.get(ctx.db, 'new-team')).toMatchObject({
    revision: 2,
    baselineInstantiationId: first.team.teamPolicy.baselineInstantiationId,
  })
  expect(teamPolicyRepo.instantiations(ctx.db, 'new-team')).toHaveLength(2)
  expect(teamPolicyRepo.bindings(ctx.db, 'new-team')).toHaveLength(4)
  const edges = teamPolicyRepo.edges(ctx.db, 'new-team')
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
  const { createProfile, teamTemplateRepo, teamPolicyRepo, registerTeam, spawnAgent } =
    await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, {
    id: 'p',
    defaultModel: 'm',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  registerTeam(ctx.db, { id: 'g' }, ctx.paths)
  const mapped = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    teamId: 'g',
    teamExpectedRevision: 1,
    placement: 'isolated',
  })
  const remaining = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    teamId: 'g',
    teamExpectedRevision: 2,
    placement: 'isolated',
  })
  teamTemplateRepo.insertCanonicalDefinition(ctx.db, {
    id: 'source',
    name: 'Source',
    slots: [{ slotId: 'slot', profileId: 'p', agentName: 'mapped' }],
    edges: [{ sourceKind: 'user', targetKind: 'slot', targetId: 'slot' }],
  })
  const previewEdges = [
    { sourceKind: 'user', sourceId: null, targetKind: 'agent', targetId: mapped.id },
    { sourceKind: 'user', sourceId: null, targetKind: 'agent', targetId: remaining.id },
    { sourceKind: 'agent', sourceId: remaining.id, targetKind: 'user', targetId: null },
    { sourceKind: 'agent', sourceId: remaining.id, targetKind: 'agent', targetId: mapped.id },
    { sourceKind: 'agent', sourceId: mapped.id, targetKind: 'agent', targetId: remaining.id },
  ].map((edge) => ({ ...edge, posture: 'allow' }))
  const preview = await teamsRouter.request('/g/policy/adopt-template/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamExpectedRevision: 3,
      templateId: 'source',
      templateExpectedRevision: 1,
      slotMappings: [{ slotId: 'slot', agentId: mapped.id }],
      remainingPlacements: [{ agentId: remaining.id, placement: 'profile_defaults' }],
    }),
  })
  expect(preview.status).toBe(200)
  expect((await preview.json()) as object).toEqual({
    edges: expect.arrayContaining(previewEdges),
  })
  const adopted = await teamsRouter.request('/g/policy/adopt-template', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamExpectedRevision: 3,
      templateId: 'source',
      templateExpectedRevision: 1,
      slotMappings: [{ slotId: 'slot', agentId: mapped.id }],
      remainingPlacements: [{ agentId: remaining.id, placement: 'profile_defaults' }],
      previewEdges,
    }),
  })
  expect(adopted.status).toBe(200)
  expect(teamPolicyRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 4,
  })
  expect(teamPolicyRepo.bindings(ctx.db, 'g')).toEqual([
    expect.objectContaining({ agentId: mapped.id, sourceSlotId: 'slot' }),
  ])
  expect(teamPolicyRepo.edges(ctx.db, 'g')).toHaveLength(previewEdges.length)

  const saved = await teamsRouter.request('/g/policy/save-as-template', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 4, id: 'saved', name: 'Saved' }),
  })
  expect(saved.status).toBe(201)
  expect((await saved.json()) as object).toMatchObject({
    template: { currentRevision: 1 },
    slots: [{ profileId: 'p' }, { profileId: 'p' }],
  })
  expect(teamPolicyRepo.get(ctx.db, 'g')?.revision).toBe(4)
  expect(teamTemplateRepo.edges(ctx.db, 'saved')).toHaveLength(previewEdges.length)
})

test('update-source transfers selected cohort bindings, prunes only emptied cohort, and preserves live edges', async () => {
  const { createProfile, teamTemplateRepo, teamPolicyRepo } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const { teamTemplatesRouter } = await import('../../src/routes/team-templates.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  teamTemplateRepo.insertCanonicalDefinition(ctx.db, {
    id: 'source',
    name: 'Source',
    slots: [{ slotId: 'slot', profileId: 'p', agentName: 'one' }],
    edges: [{ sourceKind: 'user', targetKind: 'slot', targetId: 'slot' }],
  })
  await teamTemplatesRouter.request('/source/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 1,
      teamId: 'g',
      mode: 'initialize',
    }),
  })
  const appendResponse = await teamTemplatesRouter.request('/source/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateExpectedRevision: 1,
      teamId: 'g',
      teamExpectedRevision: 1,
      mode: 'append',
    }),
  })
  const appended = (await appendResponse.json()) as { agents: Array<{ id: string }> }
  const beforeEdges = teamPolicyRepo.edges(ctx.db, 'g')
  const beforeBaseline = teamPolicyRepo.get(ctx.db, 'g')?.baselineInstantiationId

  const updated = await teamsRouter.request('/g/policy/update-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamExpectedRevision: 2,
      templateExpectedRevision: 1,
      includeAgentIds: appended.agents.map((agent) => agent.id),
    }),
  })
  expect(updated.status).toBe(200)
  expect(teamTemplateRepo.get(ctx.db, 'source')?.currentRevision).toBe(2)
  expect(teamPolicyRepo.get(ctx.db, 'g')).toMatchObject({
    revision: 3,
    baselineInstantiationId: beforeBaseline,
  })
  expect(teamPolicyRepo.edges(ctx.db, 'g')).toEqual(beforeEdges)
  expect(teamPolicyRepo.instantiations(ctx.db, 'g')).toHaveLength(1)
  expect(teamPolicyRepo.bindings(ctx.db, 'g')).toHaveLength(2)
  expect(
    teamPolicyRepo
      .bindings(ctx.db, 'g')
      .every((binding) => binding.instantiationId === beforeBaseline),
  ).toBe(true)

  teamTemplateRepo.updateCanonicalMetadata(ctx.db, 'source', {
    expectedRevision: 2,
    name: 'diverged',
  })
  const diverged = await teamsRouter.request('/g/policy/update-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamExpectedRevision: 3,
      templateExpectedRevision: 3,
      includeAgentIds: [],
    }),
  })
  expect(diverged.status).toBe(409)
  expect((await diverged.json()) as object).toMatchObject({ code: 'source_diverged' })
  expect(teamPolicyRepo.get(ctx.db, 'g')?.revision).toBe(3)
})

test('canonical move and delete update both explicit Teams exactly once through permanent Agent URLs', async () => {
  const { createProfile, teamPolicyRepo, registerTeam, spawnAgent } = await import(
    '../../src/core/index.ts'
  )
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentsRouter } = await import('../../src/routes/agents.ts')
  const { teamsRouter } = await import('../../src/routes/teams.ts')
  const ctx = getCtx()
  createProfile(ctx.db, ctx.paths, {
    id: 'p',
    defaultModel: 'm',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  registerTeam(ctx.db, { id: 'source' }, ctx.paths)
  registerTeam(ctx.db, { id: 'destination' }, ctx.paths)
  const agent = spawnAgent(ctx.db, ctx.paths, {
    profileId: 'p',
    teamId: 'source',
    teamExpectedRevision: 1,
    placement: 'profile_defaults',
  })

  const movePreview = await agentsRouter.request(`/${agent.id}/team/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: 'destination',
      sourceExpectedRevision: 2,
      destinationExpectedRevision: 1,
      placement: 'isolated',
    }),
  })
  expect(movePreview.status).toBe(200)
  expect((await movePreview.json()) as object).toMatchObject({
    source: { currentRevision: 2, resultingRevision: 3, removedEdges: expect.any(Array) },
    destination: {
      currentRevision: 1,
      resultingRevision: 2,
      existingEdges: [],
      addedEdges: [],
    },
  })

  const moved = await agentsRouter.request(`/${agent.id}/team`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: 'destination',
      sourceExpectedRevision: 2,
      destinationExpectedRevision: 1,
      placement: 'isolated',
    }),
  })
  expect(moved.status).toBe(200)
  expect(teamPolicyRepo.get(ctx.db, 'source')).toMatchObject({
    revision: 3,
  })
  expect(teamPolicyRepo.get(ctx.db, 'destination')).toMatchObject({
    revision: 2,
  })
  expect(teamPolicyRepo.edges(ctx.db, 'source')).toEqual([])
  expect(teamPolicyRepo.edges(ctx.db, 'destination')).toEqual([])

  const staleDelete = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=1`, {
    method: 'DELETE',
  })
  expect(staleDelete.status).toBe(409)
  expect(teamPolicyRepo.get(ctx.db, 'destination')?.revision).toBe(2)

  const deleted = await agentsRouter.request(`/${agent.id}?expectedTeamRevision=2`, {
    method: 'DELETE',
  })
  expect(deleted.status).toBe(204)
  expect(teamPolicyRepo.get(ctx.db, 'destination')).toMatchObject({
    revision: 3,
  })

  const deletedGroup = await teamsRouter.request('/destination?expectedTeamPolicyRevision=3', {
    method: 'DELETE',
  })
  expect(deletedGroup.status).toBe(204)
  expect(teamPolicyRepo.get(ctx.db, 'destination')).toBeNull()
})
