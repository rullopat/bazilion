import { afterEach, beforeEach, expect, test } from 'vitest'
import { archiveAgent } from '../../src/core/agent/archive.ts'
import { moveAgent } from '../../src/core/agent/move.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as teamPolicyRepo from '../../src/core/repos/teamPolicies.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { mayMessage } from '../../src/core/team-policy/authorization.ts'
import { CommunicationDeniedError, sendAgentMessage } from '../../src/lib/communication.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'm' })
})
afterEach(() => env.cleanup())

function spawn(teamId = env.teamId) {
  return spawnAgent(env.db, env.paths, { profileId: 'p', teamId })
}

test('an open Team lets members message each other without edges', () => {
  const a = spawn()
  const b = spawn()
  expect(teamPolicyRepo.get(env.db, env.teamId)?.mode).toBe('open')
  expect(mayMessage(env.db, a.id, b.id)).toEqual({ allowed: true })
  expect(mayMessage(env.db, b.id, a.id)).toEqual({ allowed: true })
})

test('a restricted Team needs a directed edge between members', () => {
  const a = spawn()
  const b = spawn()
  teamPolicyRepo.update(env.db, env.teamId, {
    mode: 'restricted',
    edges: [{ from: a.id, to: b.id }],
  })
  expect(mayMessage(env.db, a.id, b.id)).toEqual({ allowed: true })
  expect(mayMessage(env.db, b.id, a.id)).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('restricted'),
  })
})

test('messages between Teams need an outside edge on both sides, even for open Teams', () => {
  const other = registerTeam(env.db, { id: 'other' }, env.paths)
  const a = spawn()
  const b = spawn(other.id)
  expect(mayMessage(env.db, a.id, b.id)).toMatchObject({ allowed: false })
  teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: a.id, to: 'outside' }] })
  expect(mayMessage(env.db, a.id, b.id)).toMatchObject({
    allowed: false,
    reason: expect.stringContaining('other'),
  })
  teamPolicyRepo.update(env.db, other.id, { edges: [{ from: 'outside', to: b.id }] })
  expect(mayMessage(env.db, a.id, b.id)).toEqual({ allowed: true })
  expect(mayMessage(env.db, b.id, a.id)).toMatchObject({ allowed: false })
})

test('self, unknown and archived Agents cannot message', () => {
  const a = spawn()
  const b = spawn()
  expect(mayMessage(env.db, a.id, a.id)).toMatchObject({ allowed: false })
  expect(mayMessage(env.db, a.id, 'missing')).toMatchObject({ allowed: false })
  archiveAgent(env.db, b.id)
  expect(mayMessage(env.db, a.id, b.id)).toMatchObject({ allowed: false })
})

test('a denied message throws its reason and stores nothing', () => {
  const a = spawn()
  const b = spawn()
  teamPolicyRepo.update(env.db, env.teamId, { mode: 'restricted' })
  expect(() =>
    sendAgentMessage(env.db, { from: a.id, to: b.id, payload: 'no', origin: 'test' }),
  ).toThrow(CommunicationDeniedError)
  expect(messageRepo.listInbox(env.db, b.id)).toEqual([])
  teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: a.id, to: b.id }] })
  const sent = sendAgentMessage(env.db, { from: a.id, to: b.id, payload: 'yes', origin: 'test' })
  expect(messageRepo.listInbox(env.db, b.id)).toMatchObject([{ id: sent.id, payload: 'yes' }])
})

test('policy edits refuse non-members, self edges and outside-to-outside', () => {
  const a = spawn()
  const other = registerTeam(env.db, { id: 'other' }, env.paths)
  const stranger = spawn(other.id)
  expect(() =>
    teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: a.id, to: stranger.id }] }),
  ).toThrow(/not a member/)
  expect(() =>
    teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: a.id, to: a.id }] }),
  ).toThrow(/different endpoints/)
  expect(() =>
    teamPolicyRepo.update(env.db, env.teamId, { edges: [{ from: 'outside', to: 'outside' }] }),
  ).toThrow(/different endpoints/)
  expect(teamPolicyRepo.edges(env.db, env.teamId)).toEqual([])
})

test('an Agent leaving a Team leaves its edges behind', () => {
  const other = registerTeam(env.db, { id: 'other' }, env.paths)
  const a = spawn()
  const b = spawn()
  teamPolicyRepo.update(env.db, env.teamId, {
    edges: [
      { from: a.id, to: b.id },
      { from: b.id, to: 'outside' },
    ],
  })
  moveAgent(env.db, env.paths, a.id, other.id)
  expect(teamPolicyRepo.edges(env.db, env.teamId)).toEqual([{ from: b.id, to: 'outside' }])
  expect(teamPolicyRepo.edges(env.db, other.id)).toEqual([])
})
