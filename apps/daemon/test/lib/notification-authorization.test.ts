import type { AttentionItem } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { authorizeAttentionNotification } from '../../src/lib/notification-authorization.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
let item: AttentionItem
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'notice', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'notice', teamId: env.teamId })
  env.db.raw.run(
    `INSERT INTO team_policy_edges (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, 'agent', ?, 'user', '', 'allow')`,
    [env.teamId, agent.id],
  )
  item = {
    key: 'communication_approval:source',
    kind: 'communication_approval',
    sourceId: 'source',
    severity: 'action_required',
    occurredAt: Date.now(),
    updatedAt: Date.now(),
    agentId: agent.id,
    teamId: agent.teamId,
    title: 'Approval',
    diagnostic: 'Private diagnostic',
    href: '/approvals',
    acknowledgeable: false,
    acknowledgedAt: null,
  }
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})

test('allowed source egress permits metadata, while approval posture creates no recursive approval', () => {
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  expect(authorizeAttentionNotification(env.db, item).allowed).toBe(true)
  env.db.raw.run(
    "UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  expect(authorizeAttentionNotification(env.db, item)).toEqual({
    allowed: false,
    reason: 'policy_suppressed',
  })
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) n FROM communication_approvals').get()?.n,
  ).toBe(0)
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  expect(authorizeAttentionNotification(env.db, item).allowed).toBe(false)
})

test('missing attribution, captured membership changes and archived Agents fail even with enforcement off', () => {
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'off')
  const agentId = item.agentId
  if (!agentId) throw new Error('Missing fixture Agent')
  expect(authorizeAttentionNotification(env.db, { ...item, agentId: undefined }).allowed).toBe(
    false,
  )
  expect(
    authorizeAttentionNotification(env.db, item, { agentId, teamId: 'old-team' }).allowed,
  ).toBe(false)
  env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [agentId])
  expect(authorizeAttentionNotification(env.db, item).allowed).toBe(false)
})
