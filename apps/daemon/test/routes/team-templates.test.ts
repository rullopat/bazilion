import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeamPolicy, TeamTemplate } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'bazilion-team-template-route-'))
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

async function setup() {
  const core = await import('../../src/core/index.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { createApp } = await import('../../src/app.ts')
  const ctx = getCtx()
  core.providerStateRepo.setEnabled(ctx.db, 'lmstudio', true)
  core.providerModelRepo.replace(ctx.db, 'lmstudio', ['model'])
  core.createProfile(ctx.db, ctx.paths, { id: 'p', defaultModel: 'm' })
  const app = createApp()
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${ctx.authToken}`,
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
  return { core, ctx, app, call }
}

const roster = {
  name: 'Review team',
  userMd: '# Review',
  policyMode: 'restricted',
  slots: [
    { profileId: 'p', agentName: 'author' },
    { profileId: 'p', agentName: 'reviewer', layoutPosition: { x: 10, y: 20 } },
  ],
  edges: [
    { from: 0, to: 1 },
    { from: 1, to: 0 },
    { from: 1, to: 'outside' },
  ],
}

test('templates are created, read, replaced and deleted as one plain document', async () => {
  const { app, call } = await setup()
  expect((await app.request('/api/team-templates')).status).toBe(401)

  const created = await call('/api/team-templates', {
    method: 'POST',
    body: { id: 'review', ...roster },
  })
  expect(created.status).toBe(201)
  expect((await created.json()) as TeamTemplate).toMatchObject({
    id: 'review',
    policyMode: 'restricted',
    slots: [
      { agentName: 'author', layoutPosition: null },
      { agentName: 'reviewer', layoutPosition: { x: 10, y: 20 } },
    ],
    edges: expect.arrayContaining([{ from: 1, to: 'outside' }]),
  })
  expect(
    (await call('/api/team-templates', { method: 'POST', body: { id: 'review', name: 'x' } }))
      .status,
  ).toBe(400)

  const replaced = await call('/api/team-templates/review', {
    method: 'PUT',
    body: { name: 'Solo', slots: [{ profileId: 'p', agentName: 'solo' }] },
  })
  expect(replaced.status).toBe(200)
  expect((await replaced.json()) as TeamTemplate).toMatchObject({
    name: 'Solo',
    policyMode: 'open',
    userMd: null,
    slots: [{ agentName: 'solo' }],
    edges: [],
  })
  expect(((await (await call('/api/team-templates')).json()) as TeamTemplate[]).length).toBe(1)

  expect((await call('/api/team-templates/review', { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/team-templates/review')).status).toBe(404)
  expect((await call('/api/team-templates/review', { method: 'DELETE' })).status).toBe(404)
})

test('invalid template bodies are refused without changing the stored template', async () => {
  const { call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'team', ...roster } })
  for (const body of [
    { ...roster, slots: [{ profileId: 'missing', agentName: 'x' }], edges: [] },
    { ...roster, edges: [{ from: 0, to: 2 }] },
    { ...roster, edges: [{ from: 0, to: 0 }] },
    { ...roster, edges: [{ from: 'outside', to: 'outside' }] },
    { ...roster, policyMode: 'closed' },
    { ...roster, name: '' },
  ]) {
    expect((await call('/api/team-templates/team', { method: 'PUT', body })).status).toBe(400)
  }
  expect(((await (await call('/api/team-templates/team')).json()) as TeamTemplate).name).toBe(
    'Review team',
  )
})

test('spawning into a new Team creates its Agents, edges, mode and USER.md', async () => {
  const { ctx, call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'review', ...roster } })

  const spawned = await call('/api/team-templates/review/spawn', {
    method: 'POST',
    body: { teamId: 'fresh' },
  })
  expect(spawned.status).toBe(201)
  const { agents, team } = (await spawned.json()) as {
    agents: Array<{ id: string; name: string }>
    team: TeamPolicy
  }
  expect(agents.map((agent) => agent.name)).toEqual(['author', 'reviewer'])
  const [author, reviewer] = agents.map((agent) => agent.id)
  expect(team).toMatchObject({ teamId: 'fresh', mode: 'restricted' })
  expect(team.edges).toEqual(
    expect.arrayContaining([
      { from: author, to: reviewer },
      { from: reviewer, to: author },
      { from: reviewer, to: 'outside' },
    ]),
  )
  expect(team.edges).toHaveLength(3)
  const fresh = (await (await call('/api/teams/fresh')).json()) as { userMd: string }
  expect(fresh.userMd).toBe('# Review')
  expect(existsSync(ctx.paths.teamDir('fresh'))).toBe(true)
})

test('spawning into an existing Team appends with unique names and keeps its mode', async () => {
  const { call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'review', ...roster } })
  await call('/api/team-templates/review/spawn', { method: 'POST', body: { teamId: 'shared' } })
  await call('/api/teams/shared/policy', { method: 'PATCH', body: { mode: 'open' } })

  const again = await call('/api/team-templates/review/spawn', {
    method: 'POST',
    body: { teamId: 'shared' },
  })
  expect(again.status).toBe(201)
  const policy = (await (await call('/api/teams/shared/policy')).json()) as TeamPolicy
  expect(policy.mode).toBe('open')
  expect(policy.members.map((agent) => agent.name).sort()).toEqual([
    'author',
    'author-2',
    'reviewer',
    'reviewer-2',
  ])
  expect(policy.edges).toHaveLength(6)
})

test('a failed spawn leaves no new Team or Agent directories behind', async () => {
  const { ctx, call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'review', ...roster } })
  ctx.db.raw.run("UPDATE team_template_slots SET agent_name = '' WHERE position = 1")
  ctx.db.raw.run('DROP TABLE team_policy_edges')
  const failed = await call('/api/team-templates/review/spawn', {
    method: 'POST',
    body: { teamId: 'broken' },
  })
  // The dropped table makes the spawn fail inside the daemon.
  expect(failed.status).toBe(500)
  expect(existsSync(ctx.paths.teamDir('broken'))).toBe(false)
  expect(ctx.db.raw.query('SELECT id FROM agents').all()).toEqual([])
  expect(readdirSync(ctx.paths.agentsDir)).toEqual([])
})

test('a refused spawn target is never removed from disk', async () => {
  const { ctx, call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'review', ...roster } })
  const before = readdirSync(ctx.paths.home).sort()

  const escaping = await call('/api/team-templates/review/spawn', {
    method: 'POST',
    body: { teamId: '..' },
  })
  expect(escaping.status).toBe(400)
  expect(((await escaping.json()) as { error: string }).error).toContain('invalid slug')
  expect(readdirSync(ctx.paths.home).sort()).toEqual(before)
  expect(existsSync(ctx.paths.db)).toBe(true)
  expect(existsSync(ctx.paths.authFile)).toBe(true)

  // A slot already on disk without a Team row belongs to someone else: refuse, keep it.
  mkdirSync(ctx.paths.teamDir('stale'), { recursive: true })
  writeFileSync(join(ctx.paths.teamDir('stale'), 'notes.md'), 'keep me')
  const occupied = await call('/api/team-templates/review/spawn', {
    method: 'POST',
    body: { teamId: 'stale' },
  })
  expect(occupied.status).toBe(400)
  expect(((await occupied.json()) as { error: string }).error).toContain('already on disk')
  expect(readFileSync(join(ctx.paths.teamDir('stale'), 'notes.md'), 'utf8')).toBe('keep me')
  expect(ctx.db.raw.query('SELECT id FROM agents').all()).toEqual([])
  expect(readdirSync(ctx.paths.agentsDir)).toEqual([])
})

test('a live Team is saved as a template with its members, edges, mode and USER.md', async () => {
  const { call } = await setup()
  await call('/api/team-templates', { method: 'POST', body: { id: 'review', ...roster } })
  await call('/api/team-templates/review/spawn', { method: 'POST', body: { teamId: 'live' } })

  const saved = await call('/api/teams/live/policy/save-as-template', {
    method: 'POST',
    body: { id: 'copy', name: 'Copy' },
  })
  expect(saved.status).toBe(201)
  expect((await saved.json()) as TeamTemplate).toMatchObject({
    id: 'copy',
    name: 'Copy',
    userMd: '# Review',
    policyMode: 'restricted',
    slots: [{ agentName: 'author' }, { agentName: 'reviewer' }],
    edges: expect.arrayContaining([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
      { from: 1, to: 'outside' },
    ]),
  })
  expect(
    (
      await call('/api/teams/live/policy/save-as-template', {
        method: 'POST',
        body: { id: 'copy', name: 'Again' },
      })
    ).status,
  ).toBe(400)
})

test('the policy route sets the mode and edges, last write wins', async () => {
  const { core, ctx, call } = await setup()
  core.registerTeam(ctx.db, { id: 'team' }, ctx.paths)
  const a = core.spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'team' })
  const b = core.spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'team' })

  const shown = (await (await call('/api/teams/team/policy')).json()) as TeamPolicy
  expect(shown).toMatchObject({ teamId: 'team', mode: 'open', edges: [] })
  expect(shown.members.map((agent) => agent.id).sort()).toEqual([a.id, b.id].sort())

  const updated = await call('/api/teams/team/policy', {
    method: 'PATCH',
    body: { mode: 'restricted', edges: [{ from: a.id, to: b.id }] },
  })
  expect(updated.status).toBe(200)
  expect((await updated.json()) as TeamPolicy).toMatchObject({
    mode: 'restricted',
    edges: [{ from: a.id, to: b.id }],
  })
  const modeOnly = await call('/api/teams/team/policy', { method: 'PATCH', body: { mode: 'open' } })
  expect((await modeOnly.json()) as TeamPolicy).toMatchObject({
    mode: 'open',
    edges: [{ from: a.id, to: b.id }],
  })
  expect(
    (await call('/api/teams/team/policy', { method: 'PATCH', body: { mode: 'closed' } })).status,
  ).toBe(400)
  expect(
    (
      await call('/api/teams/team/policy', {
        method: 'PATCH',
        body: { edges: [{ from: a.id, to: 'someone-else' }] },
      })
    ).status,
  ).toBe(400)
  expect((await call('/api/teams/missing/policy')).status).toBe(404)
})

test('spawn, move and delete need no revision; moved Agents leave their edges behind', async () => {
  const { core, ctx, call } = await setup()
  core.registerTeam(ctx.db, { id: 'source' }, ctx.paths)
  core.registerTeam(ctx.db, { id: 'destination' }, ctx.paths)
  const spawned = await call('/api/agents', {
    method: 'POST',
    body: { profileId: 'p', teamId: 'source' },
  })
  expect(spawned.status).toBe(201)
  const { agent } = (await spawned.json()) as { agent: { id: string; dir: string } }
  const peer = core.spawnAgent(ctx.db, ctx.paths, { profileId: 'p', teamId: 'source' })
  core.teamPolicyRepo.update(ctx.db, 'source', {
    edges: [
      { from: agent.id, to: peer.id },
      { from: peer.id, to: 'outside' },
    ],
  })

  const moved = await call(`/api/agents/${agent.id}/team`, {
    method: 'PATCH',
    body: { teamId: 'destination' },
  })
  expect(moved.status).toBe(200)
  expect(core.teamPolicyRepo.edges(ctx.db, 'source')).toEqual([{ from: peer.id, to: 'outside' }])
  expect(core.agentRepo.get(ctx.db, agent.id)?.teamId).toBe('destination')

  expect((await call(`/api/agents/${agent.id}`, { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/teams/destination', { method: 'DELETE' })).status).toBe(204)
  expect(core.teamPolicyRepo.get(ctx.db, 'destination')).toBeNull()
  expect((await call('/api/teams/source', { method: 'DELETE' })).status).toBe(400)
})
