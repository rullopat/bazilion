// BAZ-098: Teams and their Agents in the order the owner puts them, the same for every client.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  home = mkdtempSync(join(tmpdir(), 'bazilion-list-order-'))
  process.env.BAZILION_HOME = home
  vi.resetModules()
})

afterEach(async () => {
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

test('the owner orders the Teams and the Agents of a Team; new ones go at the end', async () => {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { agentRepo, teamRepo } = await import('../../src/core/index.ts')
  const { rosterRevision } = await import('../../src/lib/activity.ts')
  const ctx = getCtx()
  const now = Date.now()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT OR IGNORE INTO profiles (id, name, default_model, created_at, updated_at) VALUES ('default', 'Default', 'lmstudio:qa', ?, ?)",
    [now, now],
  )
  if (!teamRepo.get(ctx.db, 'default', ctx.paths))
    teamRepo.insert(ctx.db, { id: 'default', name: 'Default' }, ctx.paths)
  teamRepo.insert(ctx.db, { id: 'launch', name: 'Launch' }, ctx.paths)
  teamRepo.insert(ctx.db, { id: 'ops', name: 'Ops' }, ctx.paths)
  const spawn = (id: string, name: string, teamId: string) =>
    agentRepo.insert(ctx.db, {
      id,
      profileId: 'default',
      name,
      modelOverride: null,
      reasoningLevel: 'medium',
      status: 'idle',
      teamId,
    })
  spawn('aaaaaaaa-0000-4000-8000-000000000001', 'Mira', 'launch')
  spawn('aaaaaaaa-0000-4000-8000-000000000002', 'Quill', 'launch')
  spawn('aaaaaaaa-0000-4000-8000-000000000003', 'Sol', 'launch')
  spawn('aaaaaaaa-0000-4000-8000-000000000004', 'Ada', 'ops')

  const app = createApp()
  const headers = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  const put = (path: string, ids: unknown) =>
    app.request(path, { method: 'PUT', headers, body: JSON.stringify({ ids }) })
  const teamIds = () => teamRepo.list(ctx.db, ctx.paths).map((team) => team.id)
  const names = (teamId?: string) =>
    agentRepo
      .list(ctx.db)
      .filter((agent) => !teamId || agent.teamId === teamId)
      .map((agent) => agent.name)

  // New Teams go at the end of the list.
  expect(teamIds()).toEqual(['default', 'launch', 'ops'])
  const before = rosterRevision(ctx.db)

  // Named first, the others after them as they were.
  const teams = await put('/api/teams/order', ['ops'])
  expect(teams.status).toBe(200)
  expect(((await teams.json()) as { id: string }[]).map((team) => team.id)).toEqual([
    'ops',
    'default',
    'launch',
  ])
  expect(teamIds()).toEqual(['ops', 'default', 'launch'])
  // The web's lists load again when another client changes the order.
  expect(rosterRevision(ctx.db)).not.toBe(before)

  // Agents by name or id prefix; every list follows the Teams' order, then the Agents'.
  const agents = await put('/api/teams/launch/agents/order', [
    'Sol',
    'aaaaaaaa-0000-4000-8000-000000000001',
  ])
  expect(agents.status).toBe(200)
  expect(((await agents.json()) as { name: string }[]).map((agent) => agent.name)).toEqual([
    'Sol',
    'Mira',
    'Quill',
  ])
  expect(names()).toEqual(['Ada', 'Sol', 'Mira', 'Quill'])

  // A new Agent goes at the end of its Team, one moved there at the end of that Team, a new Team
  // at the end of the list.
  spawn('aaaaaaaa-0000-4000-8000-000000000005', 'Nova', 'launch')
  agentRepo.setTeam(ctx.db, 'aaaaaaaa-0000-4000-8000-000000000004', 'launch')
  teamRepo.insert(ctx.db, { id: 'later', name: 'Later' }, ctx.paths)
  expect(names('launch')).toEqual(['Sol', 'Mira', 'Quill', 'Nova', 'Ada'])
  expect(teamIds()).toEqual(['ops', 'default', 'launch', 'later'])

  // Unknown names and Agents of another Team are refused, and nothing changes.
  expect((await put('/api/teams/order', ['ops', 'nope'])).status).toBe(404)
  expect((await put('/api/teams/ops/agents/order', ['Sol'])).status).toBe(404)
  expect((await put('/api/teams/order', 'ops')).status).toBe(400)
  expect(teamIds()).toEqual(['ops', 'default', 'launch', 'later'])
  expect(names('launch')).toEqual(['Sol', 'Mira', 'Quill', 'Nova', 'Ada'])
})
