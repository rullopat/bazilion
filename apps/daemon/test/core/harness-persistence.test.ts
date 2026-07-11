import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { archiveAgent } from '../../src/core/agent/archive.ts'
import { deleteAgent } from '../../src/core/agent/delete.ts'
import { moveAgentCompatibility } from '../../src/core/agent/move.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { deleteGroup } from '../../src/core/group/delete.ts'
import { registerGroup } from '../../src/core/group/register.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { deleteProfile } from '../../src/core/profile/delete.ts'
import { loadProfile } from '../../src/core/profile/load.ts'
import { updateProfile } from '../../src/core/profile/update.ts'
import { spawnProfileGroup } from '../../src/core/profile-group/spawn.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as harnessTemplateRepo from '../../src/core/repos/harnessTemplates.ts'
import * as liveHarnessRepo from '../../src/core/repos/liveHarnesses.ts'
import * as profileGroupRepo from '../../src/core/repos/profileGroups.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p1', defaultModel: 'm' })
  createProfile(env.db, env.paths, { id: 'p2', defaultModel: 'm' })
})
afterEach(() => env.cleanup())

const member = (profileId: string, agentName: string) => ({
  profileId,
  agentName,
  modelOverride: null,
  reasoningLevel: null,
})

test('legacy member replacement keeps stable slots, tombstones a suffix, and appends immutable snapshots', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'Team', userMd: 'v1' })
  profileGroupRepo.replaceMembers(env.db, 'team', [member('p1', 'a'), member('p1', 'b')])
  const revision2 = harnessTemplateRepo.revision(env.db, 'team', 2)
  const firstIds = profileGroupRepo.members(env.db, 'team').map((slot) => slot.slotId)
  expect(firstIds).toHaveLength(2)
  expect(new Set(firstIds).size).toBe(2)
  expect(harnessTemplateRepo.edges(env.db, 'team')).toHaveLength(2 + 8)

  profileGroupRepo.replaceMembers(env.db, 'team', [member('p2', 'renamed')])
  const active = profileGroupRepo.members(env.db, 'team')
  expect(active[0]?.slotId).toBe(firstIds[0])
  expect(active[0]?.profileId).toBe('p2')
  expect(harnessTemplateRepo.edges(env.db, 'team')).toHaveLength(4)
  const all = harnessTemplateRepo.slots(env.db, 'team', { includeTombstoned: true })
  expect(all.find((slot) => slot.slotId === firstIds[1])?.tombstonedAt).not.toBeNull()

  expect(revision2?.slots.map((slot) => slot.slotId)).toEqual(firstIds)
  expect(revision2?.slots.map((slot) => slot.profileId)).toEqual(['p1', 'p1'])
  expect(harnessTemplateRepo.revision(env.db, 'team', 3)?.slots).toHaveLength(1)
})

test('legacy metadata changes append a full immutable snapshot without clearing compatibility', () => {
  profileGroupRepo.insert(env.db, { id: 'metadata', name: 'Old', userMd: 'old' })
  profileGroupRepo.replaceMembers(env.db, 'metadata', [member('p1', 'one')])
  env.db.raw.run(
    `UPDATE harness_template_slots
     SET position_x = 5, position_y = 8, display_json = '{"role":"planner"}'
     WHERE template_id = 'metadata'`,
  )
  profileGroupRepo.update(env.db, 'metadata', { name: 'New', userMd: 'new' })
  const template = harnessTemplateRepo.get(env.db, 'metadata')
  expect(template).toMatchObject({
    name: 'New',
    userMd: 'new',
    currentRevision: 3,
    compatibilityManaged: true,
  })
  expect(harnessTemplateRepo.revision(env.db, 'metadata', 2)).toMatchObject({
    name: 'Old',
    userMd: 'old',
  })
  expect(harnessTemplateRepo.revision(env.db, 'metadata', 3)).toMatchObject({
    name: 'New',
    userMd: 'new',
  })
  expect(harnessTemplateRepo.revision(env.db, 'metadata', 3)?.slots[0]).toMatchObject({
    layoutPosition: { x: 5, y: 8 },
    display: { role: 'planner' },
  })
})

test('Profile communication defaults are optional, patchable, clearable, and never invented', () => {
  expect(loadProfile(env.db, 'p1').communicationDefaults).toBeNull()
  const defaults = {
    userInput: true,
    userOutput: false,
    outsideGroupInput: false,
    outsideGroupOutput: true,
    peerDefault: 'deny_all' as const,
  }
  updateProfile(env.db, env.paths, 'p1', { communicationDefaults: defaults })
  expect(loadProfile(env.db, 'p1').communicationDefaults).toEqual(defaults)
  updateProfile(env.db, env.paths, 'p1', { name: 'renamed' })
  expect(loadProfile(env.db, 'p1').communicationDefaults).toEqual(defaults)
  updateProfile(env.db, env.paths, 'p1', { communicationDefaults: null })
  expect(loadProfile(env.db, 'p1').communicationDefaults).toBeNull()
})

test('standalone Group and direct Agent lifecycle keep one exact Open policy with one bump', () => {
  const group = registerGroup(env.db, { id: 'second' }, env.paths)
  expect(liveHarnessRepo.get(env.db, group.id)).toMatchObject({
    revision: 1,
    membershipMode: 'compatibility_open',
    baselineInstantiationId: null,
  })
  const a = spawnAgent(env.db, env.paths, { profileId: 'p1', groupId: group.id })
  env.db.raw.run(
    `UPDATE live_agent_state
     SET position_x = 12, position_y = 34, display_json = '{"role":"lead"}'
     WHERE agent_id = ?`,
    [a.id],
  )
  const b = spawnAgent(env.db, env.paths, { profileId: 'p2', groupId: group.id })
  expect(liveHarnessRepo.get(env.db, group.id)?.revision).toBe(3)
  expect(liveHarnessRepo.edgeCount(env.db, group.id)).toBe(2 + 8)
  expect(
    liveHarnessRepo
      .agentState(env.db, group.id)
      .map((state) => state.agentId)
      .sort(),
  ).toEqual([a.id, b.id].sort())
  expect(
    liveHarnessRepo.agentState(env.db, group.id).find((state) => state.agentId === a.id),
  ).toMatchObject({ position: { x: 12, y: 34 }, display: { role: 'lead' } })

  archiveAgent(env.db, a.id)
  expect(liveHarnessRepo.get(env.db, group.id)?.revision).toBe(3)
  expect(liveHarnessRepo.edgeCount(env.db, group.id)).toBe(10)

  const sourceBefore = liveHarnessRepo.get(env.db, group.id)?.revision
  const destinationBefore = liveHarnessRepo.get(env.db, env.groupId)?.revision
  moveAgentCompatibility(env.db, env.paths, b.id, env.groupId)
  expect(liveHarnessRepo.get(env.db, group.id)?.revision).toBe((sourceBefore ?? 0) + 1)
  expect(liveHarnessRepo.get(env.db, env.groupId)?.revision).toBe((destinationBefore ?? 0) + 1)
  expect(JSON.parse(readFileSync(join(b.dir, 'agent.json'), 'utf8')).groupId).toBe(env.groupId)

  const deleteBefore = liveHarnessRepo.get(env.db, env.groupId)?.revision
  deleteAgent(env.db, b.id)
  expect(liveHarnessRepo.get(env.db, env.groupId)?.revision).toBe((deleteBefore ?? 0) + 1)
})

test('empty compatibility Group deletion cascades uninitialized and retained-baseline aggregates', async () => {
  const uninitialized = registerGroup(env.db, { id: 'disposable' }, env.paths)
  expect(liveHarnessRepo.get(env.db, uninitialized.id)).not.toBeNull()
  expect(() =>
    env.db.raw.run('DELETE FROM live_harnesses WHERE group_id = ?', [uninitialized.id]),
  ).toThrow(/cannot be deleted independently/i)
  deleteGroup(env.db, env.paths, uninitialized.id)
  expect(liveHarnessRepo.get(env.db, uninitialized.id)).toBeNull()

  profileGroupRepo.insert(env.db, { id: 'team-delete', name: 'Team', userMd: null })
  profileGroupRepo.replaceMembers(env.db, 'team-delete', [member('p1', 'one')])
  const spawned = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team-delete',
    groupSlug: 'retained',
  })
  deleteAgent(env.db, spawned.agents[0]?.id ?? '')
  expect(liveHarnessRepo.get(env.db, 'retained')?.baselineInstantiationId).not.toBeNull()
  deleteGroup(env.db, env.paths, 'retained')
  expect(liveHarnessRepo.get(env.db, 'retained')).toBeNull()
})

test('legacy Team spawn creates retained revision lineage and a single baseline', async () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'Team', userMd: 'starter' })
  profileGroupRepo.replaceMembers(env.db, 'team', [member('p1', 'one'), member('p2', 'two')])
  const result = await spawnProfileGroup(env.db, env.paths, {
    profileGroupId: 'team',
    groupSlug: 'spawned',
  })
  const harness = liveHarnessRepo.get(env.db, 'spawned')
  const instantiations = liveHarnessRepo.instantiations(env.db, 'spawned')
  expect(result.agents).toHaveLength(2)
  expect(harness?.revision).toBe(1)
  expect(harness?.baselineInstantiationId).toBe(instantiations[0]?.id)
  expect(instantiations[0]).toMatchObject({ templateId: 'team', templateRevision: 2 })
  const bindings = liveHarnessRepo.bindings(env.db, 'spawned')
  expect(bindings).toHaveLength(2)
  expect(liveHarnessRepo.edgeCount(env.db, 'spawned')).toBe(10)

  const liveOnly = spawnAgent(env.db, env.paths, { profileId: 'p1', groupId: 'spawned' })
  expect(() =>
    env.db.raw.run(
      `INSERT INTO source_slot_bindings (agent_id, instantiation_id, source_slot_id)
       VALUES (?, ?, ?)`,
      [liveOnly.id, bindings[0]?.instantiationId, bindings[0]?.sourceSlotId],
    ),
  ).toThrow()

  profileGroupRepo.remove(env.db, 'team')
  expect(harnessTemplateRepo.get(env.db, 'team')?.deletedAt).not.toBeNull()
  await expect(
    spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: 'again' }),
  ).rejects.toThrow(/template_deleted/)
})

test('current and live-referenced immutable revisions cannot be pruned', async () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'Team', userMd: null })
  profileGroupRepo.replaceMembers(env.db, 'team', [member('p1', 'one')])
  await spawnProfileGroup(env.db, env.paths, { profileGroupId: 'team', groupSlug: 'spawned' })
  profileGroupRepo.replaceMembers(env.db, 'team', [member('p2', 'two')])

  expect(() => harnessTemplateRepo.pruneRevision(env.db, 'team', 3)).toThrow(
    /template_revision_in_use/,
  )
  expect(() => harnessTemplateRepo.pruneRevision(env.db, 'team', 2)).toThrow(
    /template_revision_in_use/,
  )
  harnessTemplateRepo.pruneRevision(env.db, 'team', 1)
  expect(harnessTemplateRepo.revision(env.db, 'team', 1)).toBeNull()
})

test('Profile deletion is blocked by current or retained immutable Team slots', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'Team', userMd: null })
  profileGroupRepo.replaceMembers(env.db, 'team', [member('p1', 'one')])
  profileGroupRepo.replaceMembers(env.db, 'team', [])
  expect(() => deleteProfile(env.db, 'p1')).toThrow(/profile_in_use/)
})

test('explicit policy rejects omitted direct placement without leaving an Agent directory', () => {
  env.db.raw.run("UPDATE live_harnesses SET membership_mode = 'explicit' WHERE group_id = ?", [
    env.groupId,
  ])
  const beforeDirs = new Set(
    env.db.raw
      .query<{ id: string }, []>('SELECT id FROM agents')
      .all()
      .map((row) => row.id),
  )
  expect(() => spawnAgent(env.db, env.paths, { profileId: 'p1', groupId: env.groupId })).toThrow(
    /placement_required/,
  )
  expect(agentRepo.list(env.db, { includeArchived: true }).map((agent) => agent.id)).toEqual([
    ...beforeDirs,
  ])
})

test('compatibility flags never bypass a non-Open stored topology', () => {
  profileGroupRepo.insert(env.db, { id: 'drifted', name: 'Drifted', userMd: null })
  profileGroupRepo.replaceMembers(env.db, 'drifted', [member('p1', 'one')])
  env.db.raw.run(
    `DELETE FROM harness_template_edges
     WHERE template_id = 'drifted' AND source_kind = 'user'`,
  )
  expect(() => profileGroupRepo.replaceMembers(env.db, 'drifted', [member('p2', 'two')])).toThrow(
    /migration_required/,
  )

  const agent = spawnAgent(env.db, env.paths, { profileId: 'p1', groupId: env.groupId })
  env.db.raw.run(
    `DELETE FROM live_harness_edges
     WHERE group_id = ? AND source_kind = 'user' AND target_id = ?`,
    [env.groupId, agent.id],
  )
  expect(() => spawnAgent(env.db, env.paths, { profileId: 'p2', groupId: env.groupId })).toThrow(
    /group_policy_invalid/,
  )
  expect(agentRepo.list(env.db, { includeArchived: true })).toHaveLength(1)
})

test('move and delete restore filesystem state when their database transaction fails', () => {
  const second = registerGroup(env.db, { id: 'second' }, env.paths)
  const moving = spawnAgent(env.db, env.paths, { profileId: 'p1', groupId: env.groupId })
  const metadataPath = join(moving.dir, 'agent.json')
  writeFileSync(metadataPath, '{broken json')
  expect(() => moveAgentCompatibility(env.db, env.paths, moving.id, second.id)).toThrow()
  expect(agentRepo.get(env.db, moving.id)?.groupId).toBe(env.groupId)
  expect(readFileSync(metadataPath, 'utf8')).toBe('{broken json')

  env.db.raw.exec(
    `CREATE TRIGGER reject_agent_delete BEFORE DELETE ON agents
     BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END`,
  )
  expect(() => deleteAgent(env.db, moving.id)).toThrow(/forced delete failure/)
  expect(agentRepo.get(env.db, moving.id)).not.toBeNull()
  expect(existsSync(moving.dir)).toBe(true)
})
