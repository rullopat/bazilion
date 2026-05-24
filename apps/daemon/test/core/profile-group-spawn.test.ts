import { existsSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as agentSpawnModule from '../../src/core/agent/spawn.ts'
import { registerGroup } from '../../src/core/group/register.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import {
  resolveMemberNames,
  SpawnProfileGroupError,
  spawnProfileGroup,
} from '../../src/core/profile-group/spawn.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as groupRepo from '../../src/core/repos/groups.ts'
import * as profileGroupRepo from '../../src/core/repos/profileGroups.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p1', defaultModel: 'm' })
  createProfile(env.db, env.paths, { id: 'p2', defaultModel: 'm' })
})
afterEach(() => {
  vi.restoreAllMocks()
  env.cleanup()
})

interface MemberSpec {
  profileId: string
  agentName: string
  modelOverride?: string | null
  reasoningLevel?: 'medium' | 'high' | null
}

function makeTemplate(
  id: string,
  members: MemberSpec[],
  opts: { userMd?: string | null } = {},
): void {
  profileGroupRepo.insert(env.db, {
    id,
    name: id,
    userMd: opts.userMd ?? null,
  })
  profileGroupRepo.replaceMembers(
    env.db,
    id,
    members.map((m) => ({
      profileId: m.profileId,
      agentName: m.agentName,
      modelOverride: m.modelOverride ?? null,
      reasoningLevel: m.reasoningLevel ?? null,
    })),
  )
}

// --- resolveMemberNames unit ---

test('resolveMemberNames: empty existing set, no duplicates', () => {
  const members = [{ agentName: 'planner' }, { agentName: 'reviewer' }] as unknown as Parameters<
    typeof resolveMemberNames
  >[1]
  expect(resolveMemberNames(new Set(), members)).toEqual(['planner', 'reviewer'])
})

test('resolveMemberNames: duplicate member names get -2, -3 suffixes', () => {
  const members = [
    { agentName: 'reviewer' },
    { agentName: 'reviewer' },
    { agentName: 'reviewer' },
  ] as unknown as Parameters<typeof resolveMemberNames>[1]
  expect(resolveMemberNames(new Set(), members)).toEqual(['reviewer', 'reviewer-2', 'reviewer-3'])
})

test('resolveMemberNames: existing names in target group push member names forward', () => {
  const members = [{ agentName: 'reviewer' }, { agentName: 'reviewer' }] as unknown as Parameters<
    typeof resolveMemberNames
  >[1]
  expect(resolveMemberNames(new Set(['reviewer']), members)).toEqual(['reviewer-2', 'reviewer-3'])
})

test('resolveMemberNames: skips already-taken suffix numbers', () => {
  const members = [{ agentName: 'r' }] as unknown as Parameters<typeof resolveMemberNames>[1]
  expect(resolveMemberNames(new Set(['r', 'r-2']), members)).toEqual(['r-3'])
})

// --- happy path ---

test('happy path: spawns N agents into existing group with overrides applied', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'planner', modelOverride: null, reasoningLevel: null },
    {
      profileId: 'p2',
      agentName: 'reviewer',
      modelOverride: 'anthropic:claude-opus-4-6',
      reasoningLevel: 'high',
    },
  ])
  const result = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: env.groupId,
  })
  expect(result.groupSlug).toBe(env.groupId)
  expect(result.agents).toHaveLength(2)
  expect(result.agents.map((a) => a.name)).toEqual(['planner', 'reviewer'])
  expect(result.orphanAgentIds).toEqual([])

  const agents = agentRepo.list(env.db)
  expect(agents).toHaveLength(2)
  expect(agents.every((a) => a.groupId === env.groupId)).toBe(true)
  const reviewer = agents.find((a) => a.name === 'reviewer')
  expect(reviewer?.modelOverride).toBe('anthropic:claude-opus-4-6')
  expect(reviewer?.reasoningLevel).toBe('high')
  const planner = agents.find((a) => a.name === 'planner')
  expect(planner?.reasoningLevel).toBe('medium')
})

test('happy path: spawns into a freshly-created group', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'a' },
    { profileId: 'p1', agentName: 'b' },
  ])
  expect(groupRepo.get(env.db, 'fresh-target', env.paths)).toBeNull()
  const result = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: 'fresh-target',
  })
  expect(result.groupSlug).toBe('fresh-target')
  expect(groupRepo.get(env.db, 'fresh-target', env.paths)).not.toBeNull()
  expect(existsSync(env.paths.groupDir('fresh-target'))).toBe(true)
})

test('happy path: groupSlug falls back to DEFAULT_GROUP_ID when not provided', async () => {
  registerGroup(env.db, { id: 'default' }, env.paths)
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }])
  const result = await spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team' })
  expect(result.groupSlug).toBe('default')
})

// --- pre-flight validation ---

test('pre-flight: missing template throws before any side effect', async () => {
  await expect(spawnProfileGroup(env.db, env.paths, { profileGroupId: 'ghost' })).rejects.toThrow(
    /profile group not found/,
  )
})

test('pre-flight: missing referenced profile throws with the list of missing IDs', async () => {
  // Build a template, then drop the referenced profile with FKs off so the
  // member row is left orphaned. Pre-flight should catch this scenario as a
  // defense-in-depth check (the FK should normally prevent it).
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }])
  env.db.raw.exec('PRAGMA foreign_keys = OFF')
  env.db.raw.run('DELETE FROM profiles WHERE id = ?', ['p1'])
  env.db.raw.exec('PRAGMA foreign_keys = ON')

  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: env.groupId }),
  ).rejects.toThrow(/missing profiles: p1/)
  expect(agentRepo.list(env.db)).toHaveLength(0)
})

// --- atomic rollback ---

test('atomic rollback: spawnAgent failure on member 3 leaves zero agents + zero new dirs', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'a' },
    { profileId: 'p1', agentName: 'b' },
    { profileId: 'p1', agentName: 'c' },
    { profileId: 'p1', agentName: 'd' },
  ])
  const realSpawn = agentSpawnModule.spawnAgent
  let callCount = 0
  vi.spyOn(agentSpawnModule, 'spawnAgent').mockImplementation((db, paths, input) => {
    callCount++
    if (callCount === 3) throw new Error('synthetic member-3 failure')
    return realSpawn(db, paths, input)
  })

  const beforeAgentDirs = new Set(readdirSync(env.paths.agentsDir))
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: env.groupId }),
  ).rejects.toThrow(/synthetic member-3 failure/)

  expect(agentRepo.list(env.db)).toHaveLength(0)
  const afterAgentDirs = readdirSync(env.paths.agentsDir)
  expect(afterAgentDirs.filter((d) => !beforeAgentDirs.has(d))).toEqual([])
})

test('atomic rollback: pre-existing target group is left intact (only members removed)', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'a' },
    { profileId: 'p1', agentName: 'b' },
  ])
  vi.spyOn(agentSpawnModule, 'spawnAgent').mockImplementation(() => {
    throw new Error('always fail')
  })
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: env.groupId }),
  ).rejects.toThrow(/always fail/)
  expect(groupRepo.get(env.db, env.groupId, env.paths)).not.toBeNull()
  expect(existsSync(env.paths.groupDir(env.groupId))).toBe(true)
})

test('atomic rollback: freshly-created target group is removed', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'a' },
    { profileId: 'p1', agentName: 'b' },
  ])
  const realSpawn = agentSpawnModule.spawnAgent
  let callCount = 0
  vi.spyOn(agentSpawnModule, 'spawnAgent').mockImplementation((db, paths, input) => {
    callCount++
    if (callCount === 2) throw new Error('boom')
    return realSpawn(db, paths, input)
  })
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: 'fresh-target' }),
  ).rejects.toThrow(/boom/)
  expect(groupRepo.get(env.db, 'fresh-target', env.paths)).toBeNull()
  expect(existsSync(env.paths.groupDir('fresh-target'))).toBe(false)
})

test('atomic rollback: thrown error is a SpawnProfileGroupError with no orphans on clean rollback', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'a' },
    { profileId: 'p1', agentName: 'b' },
  ])
  vi.spyOn(agentSpawnModule, 'spawnAgent').mockImplementation(() => {
    throw new Error('boom')
  })
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: env.groupId }),
  ).rejects.toBeInstanceOf(SpawnProfileGroupError)
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: env.groupId }),
  ).rejects.toMatchObject({ orphanAgentIds: [] })
})

// --- USER.md seeding ---

test('USER.md seeding: populates a fresh target group from template.userMd', async () => {
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }], { userMd: '# Project notes' })
  await spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: 'fresh' })
  expect(groupRepo.get(env.db, 'fresh', env.paths)?.userMd).toBe('# Project notes')
})

test('USER.md seeding: input.userMd overrides template.userMd', async () => {
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }], { userMd: 'from template' })
  await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: 'fresh',
    userMd: 'from input',
  })
  expect(groupRepo.get(env.db, 'fresh', env.paths)?.userMd).toBe('from input')
})

test('USER.md seeding: pre-existing group is left untouched (operator intent preserved)', async () => {
  groupRepo.setUserMd(env.db, env.groupId, 'operator-written content')
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }], { userMd: 'from template' })
  await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: env.groupId,
  })
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('operator-written content')
})

test('USER.md seeding: pre-existing group with empty user_md is also left untouched', async () => {
  // Default state from registerGroup is user_md = '' — Decision #5: don't seed.
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('')
  makeTemplate('team', [{ profileId: 'p1', agentName: 'a' }], { userMd: 'should not appear' })
  await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: env.groupId,
  })
  expect(groupRepo.get(env.db, env.groupId, env.paths)?.userMd).toBe('')
})

// --- name-suffix integration ---

test('name suffixes: two reviewer members into empty group → reviewer + reviewer-2', async () => {
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'reviewer' },
    { profileId: 'p1', agentName: 'reviewer' },
  ])
  const result = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: env.groupId,
  })
  expect(result.agents.map((a) => a.name)).toEqual(['reviewer', 'reviewer-2'])
})

test('name suffixes: target already has reviewer → reviewer-2 + reviewer-3', async () => {
  // Pre-seed an existing agent named 'reviewer' in the target group via raw
  // SQL — we just need its name to occupy the namespace, no dir required.
  env.db.raw.run(
    `INSERT INTO agents (id, profile_id, name, model_override, reasoning_level, status, dir, group_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'agent-pre',
      'p1',
      'reviewer',
      null,
      'medium',
      'idle',
      env.paths.agentDir('agent-pre'),
      env.groupId,
      Date.now(),
    ],
  )
  makeTemplate('team', [
    { profileId: 'p1', agentName: 'reviewer' },
    { profileId: 'p1', agentName: 'reviewer' },
  ])
  const result = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: env.groupId,
  })
  expect(result.agents.map((a) => a.name)).toEqual(['reviewer-2', 'reviewer-3'])
})
