import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import { isActiveAgent, registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import {
  acquireAgentLifecycleLease,
  runAgentLifecycleMutation,
} from '../../src/lib/agent-lifecycle-lease.ts'
import {
  authorizeAgentEgress,
  authorizeHttpChatFrame,
  authorizeUserIngress,
  CommunicationDeniedError,
  claimDeliverableInbox,
  claimSchedulerTrigger,
} from '../../src/lib/communication.ts'
import {
  assertTeamPolicyEnforcementReleaseReady,
  TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION,
} from '../../src/lib/team-policy-contract.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let oldGate: string | undefined

beforeEach(() => {
  env = makeTestEnv()
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  createProfile(env.db, env.paths, {
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
})

afterEach(() => {
  if (oldGate === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldGate
  env.cleanup()
})

function edge(sourceKind: string, sourceId: string, targetKind: string, targetId: string) {
  env.db.raw.run(
    'INSERT INTO team_policy_edges (team_id, source_kind, source_id, target_kind, target_id) VALUES (?, ?, ?, ?, ?)',
    [env.teamId, sourceKind, sourceId, targetKind, targetId],
  )
}

test('user ingress and Agent egress re-read current policy and produce private terminal denials', () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  const ingress = { origin: 'http_chat', attemptKind: 'http_chat_ingress', attemptId: 'request' }
  expect(() => authorizeUserIngress(env.db, agent.id, ingress)).toThrow(CommunicationDeniedError)
  edge('user', '', 'agent', agent.id)
  expect(
    authorizeUserIngress(env.db, agent.id, { ...ingress, attemptId: 'request-2' }).decision,
  ).toBe('allow')

  edge('agent', agent.id, 'user', '')
  expect(
    authorizeAgentEgress(env.db, agent.id, {
      origin: 'http_chat',
      attemptKind: 'http_chat_frame',
      attemptId: 'frame-1',
    }).decision,
  ).toBe('allow')
  env.db.raw.run(
    "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  expect(() =>
    authorizeAgentEgress(env.db, agent.id, {
      origin: 'http_chat',
      attemptKind: 'http_chat_frame',
      attemptId: 'frame-2',
    }),
  ).toThrow(CommunicationDeniedError)

  const stored = env.db.raw
    .query<Record<string, unknown>, []>(
      'SELECT * FROM team_policy_block_events ORDER BY created_at',
    )
    .all()
  expect(stored).toHaveLength(2)
  expect(JSON.stringify(stored)).not.toContain('payload')
})

test('HTTP egress reauthorizes each user-facing frame and ignores internal-only frames', () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edge('agent', agent.id, 'user', '')
  expect(() =>
    authorizeHttpChatFrame(env.db, agent.id, 'turn', 0, {
      kind: 'event',
      event: { type: 'tool_call', id: 'tool', name: 'read', arguments: '{}' },
    }),
  ).not.toThrow()
  expect(() =>
    authorizeHttpChatFrame(env.db, agent.id, 'turn', 1, {
      kind: 'event',
      event: { type: 'assistant_delta', delta: 'first bytes' },
    }),
  ).not.toThrow()
  env.db.raw.run(
    "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND target_kind = 'user'",
    [env.teamId],
  )
  expect(() =>
    authorizeHttpChatFrame(env.db, agent.id, 'turn', 2, {
      kind: 'event',
      event: { type: 'assistant_delta', delta: 'must not cross transport' },
    }),
  ).toThrow(CommunicationDeniedError)
  expect(
    env.db.raw
      .query<{ attempt_id: string }, []>('SELECT attempt_id FROM team_policy_block_events')
      .get()?.attempt_id,
  ).toBe('turn:2')
})

test('ingress authorization and active registration callback are one rollback boundary', () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  expect(() =>
    authorizeUserIngress(
      env.db,
      agent.id,
      { origin: 'http_chat', attemptKind: 'http_chat_ingress', attemptId: 'atomic-start' },
      () => {
        throw new Error('registration failed')
      },
    ),
  ).toThrow('registration failed')
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(0)
})

test('trigger occurrence claim, denial, and registration callback share one transaction', () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const trigger = triggerRepo.insert(env.db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'private trigger body',
  })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  expect(() =>
    claimSchedulerTrigger(env.db, { triggerId: trigger.id, agentId: agent.id, occurrence: 100 }),
  ).toThrow(CommunicationDeniedError)
  expect(triggerRepo.get(env.db, trigger.id)?.lastFiredAt).toBe(100)
  expect(
    JSON.stringify(env.db.raw.query('SELECT * FROM team_policy_block_events').all()),
  ).not.toContain('private trigger body')

  edge('user', '', 'agent', agent.id)
  expect(() =>
    claimSchedulerTrigger(env.db, {
      triggerId: trigger.id,
      agentId: agent.id,
      occurrence: 200,
      onAllowed: () => {
        throw new Error('crash before registration commit')
      },
    }),
  ).toThrow('crash before registration commit')
  expect(triggerRepo.get(env.db, trigger.id)?.lastFiredAt).toBe(100)
})

test('scheduler claim registers under the lifecycle lease before mutation can enter', async () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const trigger = triggerRepo.insert(env.db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 1,
    cronExpr: null,
    message: 'go',
  })
  const controller = new AbortController()
  const release = await acquireAgentLifecycleLease(agent.id)
  try {
    claimSchedulerTrigger(env.db, {
      triggerId: trigger.id,
      agentId: agent.id,
      occurrence: 300,
      onAllowed: () => registerAgent(agent.id, controller),
    })
  } finally {
    release()
  }
  expect(isActiveAgent(agent.id)).toBe(true)
  await expect(runAgentLifecycleMutation(agent.id, () => 'moved')).rejects.toThrow(
    /agent_turn_active/,
  )
  unregisterAgent(agent.id)
})

test('same scheduler occurrence is claimed once under concurrent-tick replay', () => {
  const agent = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const trigger = triggerRepo.insert(env.db, {
    agentId: agent.id,
    kind: 'interval',
    intervalSec: 1,
    cronExpr: null,
    message: 'go',
  })
  let starts = 0
  expect(
    claimSchedulerTrigger(env.db, {
      triggerId: trigger.id,
      agentId: agent.id,
      occurrence: 400,
      onAllowed: () => {
        starts++
      },
    }),
  ).toBe(true)
  expect(
    claimSchedulerTrigger(env.db, {
      triggerId: trigger.id,
      agentId: agent.id,
      occurrence: 400,
      onAllowed: () => {
        starts++
      },
    }),
  ).toBe(false)
  expect(starts).toBe(1)
})

test('mixed inbox claim returns allowed rows, terminally blocks denied rows, and registers once', () => {
  const allowedSender = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const deniedSender = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const recipient = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edge('agent', allowedSender.id, 'agent', recipient.id)
  const allowed = messageRepo.send(env.db, {
    from: allowedSender.id,
    to: recipient.id,
    payload: 'allowed secret',
  })
  const denied = messageRepo.send(env.db, {
    from: deniedSender.id,
    to: recipient.id,
    payload: 'denied secret',
  })
  let registrations = 0
  const claimed = claimDeliverableInbox(env.db, recipient.id, () => {
    registrations++
  })
  expect(claimed.map((message) => message.id)).toEqual([allowed.id])
  expect(registrations).toBe(1)
  expect(messageRepo.get(env.db, allowed.id)?.readAt).not.toBeNull()
  expect(
    env.db.raw
      .query<{ policy_claimed_at: number; policy_delivered_at: number }, [string]>(
        'SELECT policy_claimed_at, policy_delivered_at FROM messages WHERE id = ?',
      )
      .get(allowed.id),
  ).toMatchObject({
    policy_claimed_at: expect.any(Number),
    policy_delivered_at: expect.any(Number),
  })
  expect(messageRepo.get(env.db, denied.id)?.readAt).toBeNull()
  expect(
    env.db.raw
      .query<{ policy_disposition: string }, [string]>(
        'SELECT policy_disposition FROM messages WHERE id = ?',
      )
      .get(denied.id)?.policy_disposition,
  ).toBe('policy_blocked')
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(1)
})

test('inbox callback failure rolls back claim, dispositions, and denial audit', () => {
  const sender = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const recipient = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const message = messageRepo.send(env.db, { from: sender.id, to: recipient.id, payload: 'secret' })
  expect(() =>
    claimDeliverableInbox(env.db, recipient.id, () => {
      throw new Error('register failed')
    }),
  ).toThrow('register failed')
  expect(messageRepo.get(env.db, message.id)?.readAt).toBeNull()
  expect(
    env.db.raw
      .query<{ policy_claimed_at: number | null; policy_delivered_at: number | null }, [string]>(
        'SELECT policy_claimed_at, policy_delivered_at FROM messages WHERE id = ?',
      )
      .get(message.id),
  ).toMatchObject({
    policy_claimed_at: null,
    policy_delivered_at: null,
  })
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(0)
})

test('inbox claim re-evaluates moved and archived membership at delivery time', () => {
  registerTeam(env.db, { id: 'other' }, env.paths)
  const sender = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const recipient = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const sender2 = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const movedMessage = messageRepo.send(env.db, {
    from: sender.id,
    to: recipient.id,
    payload: 'inserted while same Team',
  })
  env.db.raw.run('UPDATE agents SET team_id = ? WHERE id = ?', ['other', sender.id])
  expect(claimDeliverableInbox(env.db, recipient.id)).toEqual([])
  expect(
    env.db.raw
      .query<{ policy_disposition: string }, [string]>(
        'SELECT policy_disposition FROM messages WHERE id = ?',
      )
      .get(movedMessage.id)?.policy_disposition,
  ).toBe('policy_blocked')

  const archivedMessage = messageRepo.send(env.db, {
    from: sender2.id,
    to: recipient.id,
    payload: 'before archive',
  })
  env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [recipient.id])
  expect(messageRepo.listRecipientsWithUnread(env.db)).toContain(recipient.id)
  expect(claimDeliverableInbox(env.db, recipient.id)).toEqual([])
  expect(messageRepo.listRecipientsWithUnread(env.db)).not.toContain(recipient.id)
  expect(
    env.db.raw
      .query<{ policy_disposition: string }, [string]>(
        'SELECT policy_disposition FROM messages WHERE id = ?',
      )
      .get(archivedMessage.id)?.policy_disposition,
  ).toBe('policy_blocked')
})

test('compiled management contract permits activation after BAZ-017', () => {
  expect(TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION).toBe(1)
  expect(() =>
    assertTeamPolicyEnforcementReleaseReady({ BAZILION_TEAM_POLICY_ENFORCEMENT: 'on' }),
  ).not.toThrow()
  expect(() =>
    assertTeamPolicyEnforcementReleaseReady({ BAZILION_TEAM_POLICY_ENFORCEMENT: 'off' }),
  ).not.toThrow()
})
