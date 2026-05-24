import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProfile } from '../../src/core/profile/create.ts'
import * as profileGroupRepo from '../../src/core/repos/profileGroups.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  // Two profiles every test can reference. Created here so individual tests
  // stay focused on the profile-group repo, not on profile scaffolding.
  createProfile(env.db, env.paths, { id: 'p1', defaultModel: 'm' })
  createProfile(env.db, env.paths, { id: 'p2', defaultModel: 'm' })
})
afterEach(() => env.cleanup())

test('insert + get round-trip', () => {
  const inserted = profileGroupRepo.insert(env.db, {
    id: 'platform-team',
    name: 'Platform Team',
    groupSlugHint: 'acme-project',
    userMd: '# Project notes',
  })
  expect(inserted.id).toBe('platform-team')
  expect(inserted.createdAt).toBeGreaterThan(0)
  expect(inserted.updatedAt).toBe(inserted.createdAt)

  const fetched = profileGroupRepo.get(env.db, 'platform-team')
  expect(fetched).toEqual(inserted)
})

test('get returns null for missing id', () => {
  expect(profileGroupRepo.get(env.db, 'ghost')).toBeNull()
})

test('insert accepts null hint/user_md', () => {
  const g = profileGroupRepo.insert(env.db, {
    id: 't',
    name: 't',
    groupSlugHint: null,
    userMd: null,
  })
  expect(g.groupSlugHint).toBeNull()
  expect(g.userMd).toBeNull()
  const fetched = profileGroupRepo.get(env.db, 't')
  expect(fetched?.groupSlugHint).toBeNull()
  expect(fetched?.userMd).toBeNull()
})

test('replaceSlots preserves position order', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'team', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'planner', modelOverride: null, reasoningLevel: null },
    {
      profileId: 'p2',
      agentName: 'reviewer',
      modelOverride: 'anthropic:claude-opus-4-6',
      reasoningLevel: 'high',
    },
    { profileId: 'p1', agentName: 'implementer', modelOverride: null, reasoningLevel: null },
  ])
  const slots = profileGroupRepo.slots(env.db, 'team')
  expect(slots.map((s) => s.position)).toEqual([0, 1, 2])
  expect(slots.map((s) => s.agentName)).toEqual(['planner', 'reviewer', 'implementer'])
  expect(slots[1]?.modelOverride).toBe('anthropic:claude-opus-4-6')
  expect(slots[1]?.reasoningLevel).toBe('high')
})

test('replaceSlots PUT semantics: add, remove, reorder', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'team', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'a', modelOverride: null, reasoningLevel: null },
    { profileId: 'p1', agentName: 'b', modelOverride: null, reasoningLevel: null },
    { profileId: 'p1', agentName: 'c', modelOverride: null, reasoningLevel: null },
  ])
  // Reorder + drop one + add one
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'c', modelOverride: null, reasoningLevel: null },
    { profileId: 'p2', agentName: 'd', modelOverride: null, reasoningLevel: null },
    { profileId: 'p1', agentName: 'a', modelOverride: null, reasoningLevel: null },
  ])
  const slots = profileGroupRepo.slots(env.db, 'team')
  expect(slots.map((s) => s.agentName)).toEqual(['c', 'd', 'a'])
  expect(slots.map((s) => s.profileId)).toEqual(['p1', 'p2', 'p1'])
})

test('replaceSlots accepts duplicate agentName values (spawn handles via -2 suffix)', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 'team', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'reviewer', modelOverride: null, reasoningLevel: null },
    { profileId: 'p1', agentName: 'reviewer', modelOverride: null, reasoningLevel: null },
  ])
  expect(profileGroupRepo.slots(env.db, 'team')).toHaveLength(2)
})

test('update with partial patch only touches included keys', () => {
  const t0 = profileGroupRepo.insert(env.db, {
    id: 'team',
    name: 'Old name',
    groupSlugHint: 'acme',
    userMd: 'original',
  })
  // Sleep 2ms so updated_at strictly increases (Date.now resolution).
  const start = Date.now()
  while (Date.now() === start) {
    // spin
  }
  profileGroupRepo.update(env.db, 'team', { name: 'New name' })
  const after = profileGroupRepo.get(env.db, 'team')
  expect(after?.name).toBe('New name')
  expect(after?.groupSlugHint).toBe('acme') // untouched
  expect(after?.userMd).toBe('original') // untouched
  expect(after?.updatedAt).toBeGreaterThan(t0.updatedAt)
})

test('update with explicit null clears nullable columns', () => {
  profileGroupRepo.insert(env.db, {
    id: 'team',
    name: 't',
    groupSlugHint: 'acme',
    userMd: 'note',
  })
  profileGroupRepo.update(env.db, 'team', { groupSlugHint: null, userMd: null })
  const after = profileGroupRepo.get(env.db, 'team')
  expect(after?.groupSlugHint).toBeNull()
  expect(after?.userMd).toBeNull()
})

test('update with empty patch is a no-op (no SQL run)', () => {
  const t0 = profileGroupRepo.insert(env.db, {
    id: 'team',
    name: 't',
    groupSlugHint: null,
    userMd: null,
  })
  profileGroupRepo.update(env.db, 'team', {})
  const after = profileGroupRepo.get(env.db, 'team')
  // updated_at must NOT bump when nothing changes.
  expect(after?.updatedAt).toBe(t0.updatedAt)
})

test('remove cascades to slots, leaves profiles intact', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 't', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'a', modelOverride: null, reasoningLevel: null },
    { profileId: 'p2', agentName: 'b', modelOverride: null, reasoningLevel: null },
  ])
  expect(profileGroupRepo.slots(env.db, 'team')).toHaveLength(2)

  profileGroupRepo.remove(env.db, 'team')
  expect(profileGroupRepo.get(env.db, 'team')).toBeNull()
  expect(profileGroupRepo.slots(env.db, 'team')).toEqual([])
  // Profiles unaffected.
  expect(profileRepo.get(env.db, 'p1')).not.toBeNull()
  expect(profileRepo.get(env.db, 'p2')).not.toBeNull()
})

test('ON DELETE RESTRICT blocks deleting a profile referenced by a slot', () => {
  profileGroupRepo.insert(env.db, { id: 'team', name: 't', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'team', [
    { profileId: 'p1', agentName: 'planner', modelOverride: null, reasoningLevel: null },
  ])
  expect(() => profileRepo.remove(env.db, 'p1')).toThrow()
  // Profile still exists, slot still references it.
  expect(profileRepo.get(env.db, 'p1')).not.toBeNull()
  expect(profileGroupRepo.slots(env.db, 'team')).toHaveLength(1)
})

test('list returns slotCount matching actual slot rows', () => {
  profileGroupRepo.insert(env.db, { id: 'empty', name: 'e', groupSlugHint: null, userMd: null })
  profileGroupRepo.insert(env.db, { id: 'one', name: 'o', groupSlugHint: null, userMd: null })
  profileGroupRepo.insert(env.db, { id: 'three', name: 't', groupSlugHint: null, userMd: null })
  profileGroupRepo.replaceSlots(env.db, 'one', [
    { profileId: 'p1', agentName: 'a', modelOverride: null, reasoningLevel: null },
  ])
  profileGroupRepo.replaceSlots(env.db, 'three', [
    { profileId: 'p1', agentName: 'a', modelOverride: null, reasoningLevel: null },
    { profileId: 'p1', agentName: 'b', modelOverride: null, reasoningLevel: null },
    { profileId: 'p2', agentName: 'c', modelOverride: null, reasoningLevel: null },
  ])
  const all = profileGroupRepo.list(env.db)
  const counts = Object.fromEntries(all.map((g) => [g.id, g.slotCount]))
  expect(counts).toEqual({ empty: 0, one: 1, three: 3 })
})

test('list orders by created_at ascending', () => {
  profileGroupRepo.insert(env.db, { id: 'first', name: '1', groupSlugHint: null, userMd: null })
  // Make sure created_at strictly differs.
  const start = Date.now()
  while (Date.now() === start) {
    // spin
  }
  profileGroupRepo.insert(env.db, { id: 'second', name: '2', groupSlugHint: null, userMd: null })
  const ids = profileGroupRepo.list(env.db).map((g) => g.id)
  expect(ids).toEqual(['first', 'second'])
})
