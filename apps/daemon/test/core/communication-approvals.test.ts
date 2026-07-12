import type { CommunicationApprovalDetail } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as approvalRepo from '../../src/core/repos/communicationApprovals.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import * as teamTemplateRepo from '../../src/core/repos/teamTemplates.ts'
import * as triggerRepo from '../../src/core/repos/triggers.ts'
import {
  authorizeCommunication,
  authorizeInSnapshot,
} from '../../src/core/team-policy/authorization.ts'
import { spawnTeamTemplate } from '../../src/core/team-policy/spawn.ts'
import {
  CommunicationPendingError,
  claimDeliverableInbox,
  claimSchedulerTrigger,
  sendAgentMessage,
} from '../../src/lib/communication.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let oldGate: string | undefined

beforeEach(() => {
  env = makeTestEnv()
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  createProfile(env.db, env.paths, { id: 'p', defaultModel: 'm' })
})

afterEach(() => {
  if (oldGate === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
  else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = oldGate
  env.cleanup()
})

function protectedPair() {
  const source = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const target = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  env.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, 'agent', ?, 'agent', ?, 'approval_required')`,
    [env.teamId, source.id, target.id],
  )
  return { source, target }
}

test('approval posture is a third decision without changing absent-edge denial', () => {
  const { source, target } = protectedPair()
  const input = {
    source: { kind: 'agent' as const, id: source.id },
    target: { kind: 'agent' as const, id: target.id },
    origin: 'test',
    attemptKind: 'test',
    attemptId: 'decision',
  }
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'approval_required',
    reasonCode: 'approval_required',
    componentOutcomes: [{ matched: true, posture: 'approval_required' }],
  })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'deny',
    reasonCode: 'no_allow_edge',
  })
})

test('pending Agent message is idempotent, private in lists, and delivered at most once', () => {
  const { source, target } = protectedPair()
  const send = () =>
    sendAgentMessage(env.db, {
      from: source.id,
      to: target.id,
      payload: JSON.stringify({ text: 'sensitive payload' }),
      origin: 'test',
      attemptKind: 'approval-test',
      attemptId: 'same-key',
    })
  let first: CommunicationPendingError | null = null
  try {
    send()
  } catch (error) {
    expect(error).toBeInstanceOf(CommunicationPendingError)
    first = error as CommunicationPendingError
  }
  expect(first).not.toBeNull()
  expect(messageRepo.listInbox(env.db, target.id)).toEqual([])
  let second: CommunicationPendingError | null = null
  try {
    send()
  } catch (error) {
    second = error as CommunicationPendingError
  }
  expect(second?.approval.id).toBe(first?.approval.id)
  expect(approvalRepo.list(env.db)).toHaveLength(1)
  expect(JSON.stringify(approvalRepo.list(env.db))).not.toContain('sensitive payload')

  const id = first?.approval.id as string
  const claimed = approvalRepo.claimDelivery(env.db, id, 'operator', (approval) =>
    authorizeInSnapshot(env.db, {
      source: approval.source,
      target: approval.target,
      origin: approval.origin,
      attemptKind: approval.attemptKind,
      attemptId: approval.attemptId,
    }),
  )
  const payload = claimed.payload as { from: string; to: string; payload: string }
  messageRepo.send(env.db, payload)
  approvalRepo.finishDelivery(env.db, id, true, 'operator')
  expect(messageRepo.listInbox(env.db, target.id)).toHaveLength(1)
  expect(() =>
    approvalRepo.claimDelivery(env.db, id, 'other', () =>
      authorizeInSnapshot(env.db, {
        source: claimed.source,
        target: claimed.target,
        origin: claimed.origin,
        attemptKind: claimed.attemptKind,
        attemptId: claimed.attemptId,
      }),
    ),
  ).toThrow(/current delivered/)
  expect(messageRepo.listInbox(env.db, target.id)).toHaveLength(1)
})

test('expiry, terminal denial, and policy change all fail closed', () => {
  const { source, target } = protectedPair()
  const input = {
    source: { kind: 'agent' as const, id: source.id },
    target: { kind: 'agent' as const, id: target.id },
    origin: 'test',
    attemptKind: 'expiry',
    attemptId: 'one',
  }
  const authorization = authorizeCommunication(env.db, input)
  const expired = approvalRepo.request(
    env.db,
    input,
    'send_agent_message',
    authorization,
    'agent_message',
    { from: source.id, to: target.id, payload: '{}' },
    { now: 1_000, ttlMs: 10 },
  )
  approvalRepo.expirePending(env.db, 1_011)
  expect(approvalRepo.get(env.db, expired.id)).toMatchObject({ status: 'expired' })
  expect(() =>
    approvalRepo.decide(env.db, expired.id, 'deny', 'operator', undefined, 1_012),
  ).toThrow(/current expired/)
  expect(() =>
    approvalRepo.claimDelivery(env.db, expired.id, 'operator', () => authorization, 1_012),
  ).toThrow(/current expired/)

  const pending = approvalRepo.request(
    env.db,
    { ...input, attemptId: 'two' },
    'send_agent_message',
    authorization,
    'agent_message',
    { from: source.id, to: target.id, payload: '{}' },
  )
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  expect(() =>
    approvalRepo.claimDelivery(env.db, pending.id, 'operator', (approval) =>
      authorizeInSnapshot(env.db, {
        source: approval.source,
        target: approval.target,
        origin: approval.origin,
        attemptKind: approval.attemptKind,
        attemptId: approval.attemptId,
      }),
    ),
  ).toThrow(/revalidation_failed/)
  const detail = approvalRepo.get(env.db, pending.id, true) as CommunicationApprovalDetail
  expect(detail.status).toBe('denied')
  expect(detail.events.map((item) => item.event)).toEqual(['requested', 'denied'])
  expect(messageRepo.listInbox(env.db, target.id)).toEqual([])
})

test('scheduler and inbox boundaries hold protected effects until one approval grant', () => {
  const { source, target } = protectedPair()
  env.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, 'user', '', 'agent', ?, 'approval_required')`,
    [env.teamId, target.id],
  )
  const trigger = triggerRepo.insert(env.db, {
    agentId: target.id,
    kind: 'interval',
    intervalSec: 60,
    cronExpr: null,
    message: 'scheduled prompt',
  })
  let started = false
  expect(
    claimSchedulerTrigger(env.db, {
      triggerId: trigger.id,
      agentId: target.id,
      occurrence: 1234,
      onAllowed: () => {
        started = true
      },
    }),
  ).toBe(false)
  expect(started).toBe(false)
  expect(approvalRepo.list(env.db).some((item) => item.operation === 'scheduler_trigger')).toBe(
    true,
  )

  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  env.db.raw.run(
    `INSERT INTO team_policy_edges
       (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, 'agent', ?, 'agent', ?, 'allow')`,
    [env.teamId, source.id, target.id],
  )
  const message = messageRepo.send(env.db, {
    from: source.id,
    to: target.id,
    payload: JSON.stringify({ text: 'held inbox' }),
  })
  env.db.raw.run(
    `UPDATE team_policy_edges SET posture = 'approval_required'
     WHERE team_id = ? AND source_id = ? AND target_id = ?`,
    [env.teamId, source.id, target.id],
  )
  expect(claimDeliverableInbox(env.db, target.id)).toEqual([])
  const inboxApproval = approvalRepo
    .list(env.db)
    .find((item) => item.payloadKind === 'inbox_message')
  expect(inboxApproval).toBeDefined()
  const claimed = approvalRepo.claimDelivery(
    env.db,
    inboxApproval?.id as string,
    'operator',
    (approval) =>
      authorizeInSnapshot(env.db, {
        source: approval.source,
        target: approval.target,
        origin: approval.origin,
        attemptKind: approval.attemptKind,
        attemptId: approval.attemptId,
      }),
  )
  env.db.raw.run(
    `INSERT INTO communication_approval_message_grants
       (approval_id, message_id, created_at) VALUES (?, ?, ?)`,
    [claimed.id, message.id, Date.now()],
  )
  approvalRepo.finishDelivery(env.db, claimed.id, true, 'operator')
  expect(claimDeliverableInbox(env.db, target.id).map((item) => item.id)).toEqual([message.id])
})

test('approval posture survives Team snapshots and spawn into live policy', async () => {
  teamTemplateRepo.insertCanonicalDefinition(env.db, {
    id: 'approval-team',
    name: 'Approval team',
    slots: [{ slotId: 'slot', profileId: 'p', agentName: 'reviewed' }],
    edges: [
      {
        sourceKind: 'user',
        targetKind: 'slot',
        targetId: 'slot',
        posture: 'approval_required',
      },
    ],
  })
  expect(teamTemplateRepo.revision(env.db, 'approval-team', 1)?.edges).toMatchObject([
    { posture: 'approval_required' },
  ])
  const result = await spawnTeamTemplate(env.db, env.paths, {
    templateId: 'approval-team',
    templateExpectedRevision: 1,
    teamId: 'approval-spawn',
    mode: 'initialize',
  })
  expect(result.team.edges).toMatchObject([{ posture: 'approval_required' }])
})
