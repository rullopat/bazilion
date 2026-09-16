import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as approvalRepo from '../../src/core/repos/communicationApprovals.ts'
import * as messageRepo from '../../src/core/repos/messages.ts'
import { registerTeam } from '../../src/core/team/register.ts'
import {
  authorizeCommunication,
  authorizeInSnapshot,
  recordDenial,
} from '../../src/core/team-policy/authorization.ts'
import { planApprovalDelivery } from '../../src/lib/approval-delivery-plan.ts'
import {
  authorizeOperatorVerification,
  authorizeVerificationRequest,
  CommunicationDeniedError,
  deliverableInbox,
  sendAgentMessage,
} from '../../src/lib/communication.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let oldGate: string | undefined
beforeEach(() => {
  env = makeTestEnv()
  oldGate = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
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

function edge(team: string, sk: string, sid: string, tk: string, tid: string) {
  env.db.raw.run(
    'INSERT INTO team_policy_edges (team_id, source_kind, source_id, target_kind, target_id) VALUES (?, ?, ?, ?, ?)',
    [team, sk, sid, tk, tid],
  )
}

/** An edge with an explicit posture; the default edge helper always allows. */
function edgeWithPosture(
  team: string,
  sk: string,
  sid: string,
  tk: string,
  tid: string,
  posture: 'allow' | 'approval_required',
) {
  env.db.raw.run(
    `INSERT INTO team_policy_edges
     (team_id, source_kind, source_id, target_kind, target_id, posture)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [team, sk, sid, tk, tid, posture],
  )
}

test('exact same-Team edges decide independently of origin', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edge(env.teamId, 'agent', a.id, 'agent', b.id)
  const base = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    attemptKind: 'test',
    attemptId: '1',
  }
  expect(authorizeCommunication(env.db, { ...base, origin: 'tool' })).toMatchObject({
    decision: 'allow',
    channel: 'same_team',
  })
  expect(authorizeCommunication(env.db, { ...base, origin: 'http' })).toMatchObject({
    decision: 'allow',
    channel: 'same_team',
  })
  expect(
    authorizeCommunication(env.db, {
      ...base,
      source: base.target,
      target: base.source,
      origin: 'tool',
    }),
  ).toMatchObject({ decision: 'deny', reasonCode: 'no_allow_edge' })
})

test('cross-Team decisions are two-sided and retain both policy revisions', () => {
  registerTeam(env.db, { id: 'other' }, env.paths)
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: 'other' })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id IN (?, ?)', [env.teamId, 'other'])
  edge(env.teamId, 'agent', a.id, 'outside_team', '')
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'tool',
    attemptKind: 'test',
    attemptId: 'cross',
  }
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'deny',
    channel: 'cross_team',
    reasonCode: 'target_outside_input_denied',
    policyRefs: [{ teamId: env.teamId }, { teamId: 'other' }],
    componentOutcomes: [{ matched: true }, { matched: false }],
  })
  edge('other', 'outside_team', '', 'agent', b.id)
  expect(authorizeCommunication(env.db, input)).toMatchObject({
    decision: 'allow',
    componentOutcomes: [{ matched: true }, { matched: true }],
  })
})

test('boundary, lifecycle, missing policy, and invalid paths fail closed', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const userInput = {
    source: { kind: 'user' as const, teamId: env.teamId },
    target: { kind: 'agent' as const, id: a.id },
    origin: 'http',
    attemptKind: 'test',
    attemptId: 'u',
  }
  expect(authorizeCommunication(env.db, userInput).decision).toBe('allow')
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = ?', [
    env.teamId,
    'user',
  ])
  expect(authorizeCommunication(env.db, userInput)).toMatchObject({
    decision: 'deny',
    reasonCode: 'no_allow_edge',
  })
  env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [a.id])
  expect(authorizeCommunication(env.db, userInput).reasonCode).toBe('agent_archived')
  expect(
    authorizeCommunication(env.db, { ...userInput, target: { kind: 'agent', id: 'missing' } })
      .reasonCode,
  ).toBe('agent_not_found')
  expect(
    authorizeCommunication(env.db, {
      ...userInput,
      source: { kind: 'user', teamId: env.teamId },
      target: { kind: 'outside_team', teamId: env.teamId },
    }).reasonCode,
  ).toBe('invalid_communication_path')
})

test('missing and corrupt Team policy have distinct stable denials', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const input = {
    source: { kind: 'user' as const, teamId: env.teamId },
    target: { kind: 'agent' as const, id: a.id },
    origin: 'test',
    attemptKind: 'test',
    attemptId: 'policy',
  }
  env.db.raw.exec('PRAGMA ignore_check_constraints = ON')
  env.db.raw.run('UPDATE team_policies SET revision = 0 WHERE team_id = ?', [env.teamId])
  expect(authorizeCommunication(env.db, input).reasonCode).toBe('team_policy_invalid')
  env.db.raw.exec('DROP TRIGGER prevent_detached_team_policy_delete')
  env.db.raw.run('DELETE FROM team_policies WHERE team_id = ?', [env.teamId])
  expect(authorizeCommunication(env.db, input).reasonCode).toBe('team_policy_missing')
})

test('typed denial identity is immutable, idempotent, private, and rejects semantic collision', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'first',
    attemptKind: 'agent_tool',
    attemptId: 'same',
  }
  const result = authorizeCommunication(env.db, input)
  recordDenial(env.db, input, 'send_agent_message', result)
  recordDenial(env.db, { ...input, origin: 'retry' }, 'send_agent_message', result)
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(1)
  const stored = env.db.raw
    .query<Record<string, unknown>, []>('SELECT * FROM team_policy_block_events')
    .get()
  expect(stored?.origin).toBe('first')
  expect(JSON.stringify(stored)).not.toContain('payload')
  expect(
    recordDenial(
      env.db,
      { ...input, target: { kind: 'agent', id: a.id } },
      'send_agent_message',
      result,
    ).reasonCode,
  ).toBe('attempt_key_conflict')
})

test('unique-insert race reloads the winner and applies its fingerprint', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  const input = {
    source: { kind: 'agent' as const, id: a.id },
    target: { kind: 'agent' as const, id: b.id },
    origin: 'race',
    attemptKind: 'agent_tool',
    attemptId: 'race',
  }
  const result = authorizeCommunication(env.db, input)
  const originalRun = env.db.raw.run.bind(env.db.raw)
  let simulated = false
  env.db.raw.run = (sql, params) => {
    const value = originalRun(sql, params)
    if (!simulated && sql.startsWith('INSERT INTO team_policy_block_events')) {
      simulated = true
      throw new Error('simulated unique race')
    }
    return value
  }
  expect(recordDenial(env.db, input, 'send_agent_message', result)).toMatchObject({
    reasonCode: 'no_allow_edge',
  })
  env.db.raw.run = originalRun
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(1)
})

test('gate defaults off; enabled denial is atomic and allowed replies preserve linkage', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  const off = sendAgentMessage(env.db, { from: a.id, to: b.id, payload: 'off', origin: 'test' })
  expect(off.payload).toBe('off')
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(0)
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  expect(() =>
    sendAgentMessage(env.db, {
      from: a.id,
      to: b.id,
      payload: 'secret',
      origin: 'test',
      attemptKind: 'test',
      attemptId: 'deny',
    }),
  ).toThrow(CommunicationDeniedError)
  expect(
    env.db.raw
      .query<{ count: number }, []>("SELECT COUNT(*) count FROM messages WHERE payload = 'secret'")
      .get()?.count,
  ).toBe(0)
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(1)
  edge(env.teamId, 'agent', a.id, 'agent', b.id)
  const allowed = sendAgentMessage(env.db, {
    from: a.id,
    to: b.id,
    payload: 'ok',
    replyTo: off.id,
    origin: 'test',
  })
  expect(allowed.replyTo).toBe(off.id)
})

test('Agent inbox reauthorization atomically blocks stale deliveries while operator history remains visible', () => {
  const a = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const b = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const message = messageRepo.send(env.db, { from: a.id, to: b.id, payload: 'historical' })
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  expect(deliverableInbox(env.db, b.id, true)).toEqual([])
  expect(deliverableInbox(env.db, b.id, true)).toEqual([])
  expect(messageRepo.listInboxForOperator(env.db, b.id)).toMatchObject([
    { id: message.id, payload: 'historical' },
  ])
  expect(
    env.db.raw
      .query<{ policy_disposition: string }, [string]>(
        'SELECT policy_disposition FROM messages WHERE id = ?',
      )
      .get(message.id)?.policy_disposition,
  ).toBe('policy_blocked')
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
      .get()?.count,
  ).toBe(1)
})

// BAZ-044: a verification request is authorized on the canonical agent-to-agent edge, and a held
// approval releases it as a durable grant rather than executing anything in the HTTP request.
test('a verification request is authorized on the peer edge and held once when approval is required', () => {
  const coder = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const tester = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const requestId = '11111111-2222-4333-8444-555555555555'
  // Gate off: authorization succeeds without creating anything durable.
  expect(() =>
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId }),
  ).not.toThrow()
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM communication_approvals')
      .get()?.count,
  ).toBe(0)

  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  // No edge: denied with durable evidence, and nothing is held.
  expect(() =>
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId }),
  ).toThrow(CommunicationDeniedError)
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM communication_approvals')
      .get()?.count,
  ).toBe(0)

  // An approval-required edge captures the attempt exactly once, keyed on the request id.
  edgeWithPosture(env.teamId, 'agent', coder.id, 'agent', tester.id, 'approval_required')
  let held: unknown
  try {
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId })
    throw new Error('expected the request to be held')
  } catch (error) {
    held = error
  }
  expect(String(held)).toContain('approval')
  const approvalRow = env.db.raw
    .query<{ attempt_kind: string; attempt_id: string; operation: string; status: string }, []>(
      'SELECT attempt_kind, attempt_id, operation, status FROM communication_approvals',
    )
    .get()
  expect(approvalRow).toEqual({
    attempt_kind: 'verification_request',
    attempt_id: requestId,
    operation: 'request_verification',
    status: 'pending',
  })
  // Attempting again does not create a second approval: the attempt tuple is unique.
  expect(() =>
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId }),
  ).toThrow()
  expect(
    env.db.raw
      .query<{ count: number }, []>('SELECT COUNT(*) count FROM communication_approvals')
      .get()?.count,
  ).toBe(1)
})

test('a held verification request releases exactly once, and only while it is still dispatchable', () => {
  const coder = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const tester = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const requestId = '11111111-2222-4333-8444-555555555555'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edgeWithPosture(env.teamId, 'agent', coder.id, 'agent', tester.id, 'approval_required')
  expect(() =>
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId }),
  ).toThrow()
  const approvalId = env.db.raw
    .query<{ id: string }, []>('SELECT id FROM communication_approvals')
    .get()?.id
  if (!approvalId) throw new Error('expected a pending approval')

  const revalidate = (approval: {
    source: never
    target: never
    origin: string
    attemptKind: string
    attemptId: string
  }) =>
    authorizeInSnapshot(env.db, {
      source: approval.source,
      target: approval.target,
      origin: approval.origin,
      attemptKind: approval.attemptKind,
      attemptId: approval.attemptId,
    })

  // A request whose inputs no longer hold is refused, and the approval is not left granted.
  const blocked = approvalRepo.grantVerificationRequest(
    env.db,
    approvalId,
    'operator',
    revalidate as never,
    (approval) => {
      expect(approval.payload).toMatchObject({ requestId })
      return 'verification request is no longer dispatchable'
    },
    () => {
      throw new Error('must not release an unvalidated request')
    },
  )
  expect(blocked).toMatchObject({ granted: false, failureKind: 'delivery' })
  expect(
    env.db.raw.query<{ status: string }, []>('SELECT status FROM communication_approvals').get()
      ?.status,
  ).toBe('delivery_failed')

  // Revalidation failure (policy or membership changed) denies rather than grants.
  const secondRequestId = '22222222-2222-4333-8444-555555555555'
  const second = approvalRepo.request(
    env.db,
    {
      source: { kind: 'agent', id: coder.id },
      target: { kind: 'agent', id: tester.id },
      origin: 'verification_request',
      attemptKind: 'verification_request',
      attemptId: secondRequestId,
    },
    'request_verification',
    {
      decision: 'approval_required',
      channel: 'same_team',
      reasonCode: 'approval_required',
      reason: 'edge requires approval',
      policyRefs: [],
      componentOutcomes: [],
      matchedEdgeIds: [],
      requiredEdgeIds: [],
    },
    'verification_request',
    { requestId: secondRequestId },
    { requester: coder.id },
  )
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  const denied = approvalRepo.grantVerificationRequest(
    env.db,
    second.id,
    'operator',
    revalidate as never,
    () => null,
    () => {
      throw new Error('must not release a denied request')
    },
  )
  expect(denied).toMatchObject({ granted: false, failureKind: 'revalidation' })
})

test('a granted verification request runs its guarded release inside the decision', () => {
  const coder = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const tester = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const requestId = '99999999-2222-4333-8444-555555555555'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edgeWithPosture(env.teamId, 'agent', coder.id, 'agent', tester.id, 'approval_required')
  expect(() =>
    authorizeVerificationRequest(env.db, { from: coder.id, to: tester.id, requestId }),
  ).toThrow()
  const approvalId = env.db.raw
    .query<{ id: string }, []>('SELECT id FROM communication_approvals')
    .get()?.id
  if (!approvalId) throw new Error('expected a pending approval')

  const released: string[] = []
  const grant = approvalRepo.grantVerificationRequest(
    env.db,
    approvalId,
    'operator',
    (approval) =>
      authorizeInSnapshot(env.db, {
        source: approval.source,
        target: approval.target,
        origin: approval.origin,
        attemptKind: approval.attemptKind,
        attemptId: approval.attemptId,
      }),
    (approval) => {
      expect(approval.attemptId).toBe(requestId)
      return null
    },
    (approval) => released.push(String(approval.attemptId)),
  )
  expect(grant).toMatchObject({ granted: true, approval: { status: 'delivered' } })
  // The release committed with the decision, and only once.
  expect(released).toEqual([requestId])
  expect(() =>
    approvalRepo.grantVerificationRequest(
      env.db,
      approvalId,
      'operator',
      () => {
        throw new Error('must not revalidate a settled approval')
      },
      () => null,
      () => released.push('again'),
    ),
  ).toThrow(/approval_state_conflict/)
  expect(released).toEqual([requestId])
})

// Review S3/S4: a held request must be releasable — including one the operator asked for, whose
// approval tuple previously used the generic user-ingress operation and was undeliverable.
test('a held request releases into pending, for an agent or the operator requester', async () => {
  const coder = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const tester = spawnAgent(env.db, env.paths, { profileId: 'p', teamId: env.teamId })
  const requestId = '33333333-2222-4333-8444-555555555555'
  process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  edgeWithPosture(env.teamId, 'agent', coder.id, 'agent', tester.id, 'approval_required')
  edgeWithPosture(env.teamId, 'user', '', 'agent', tester.id, 'approval_required')

  for (const [label, capture] of [
    [
      'agent',
      () =>
        authorizeVerificationRequest(env.db, {
          from: coder.id,
          to: tester.id,
          requestId,
        }),
    ],
    ['operator', () => authorizeOperatorVerification(env.db, { agentId: tester.id, requestId })],
  ] as const) {
    expect(capture, label).toThrow()
    const row = env.db.raw
      .query<{ id: string; operation: string; payload_kind: string; attempt_id: string }, []>(
        'SELECT id, operation, payload_kind, attempt_id FROM communication_approvals ORDER BY created_at DESC LIMIT 1',
      )
      .get()
    // One operation per attempt kind, whoever asked: that is what makes the plan recognisable.
    expect(row, label).toMatchObject({
      operation: 'request_verification',
      payload_kind: 'verification_request',
      attempt_id: requestId,
    })
    if (!row) continue
    // The plan validator accepts it, so the approval can actually be delivered.
    const detail = approvalRepo.get(env.db, row.id, true)
    expect(detail).not.toBeNull()
    expect(planApprovalDelivery(detail as never)).toMatchObject({
      kind: 'verification_request',
      payload: { requestId },
    })
    env.db.raw.run('DELETE FROM communication_approvals WHERE id = ?', [row.id])
  }
})
