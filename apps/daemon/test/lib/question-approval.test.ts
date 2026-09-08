import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CommunicationApprovalDetail } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { authorizeInSnapshot } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as approvals from '../../src/core/repos/communicationApprovals.ts'
import * as questions from '../../src/core/repos/questions.ts'
import {
  authorizeQuestionBoundary,
  validateQuestionApproval,
} from '../../src/lib/question-approval.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let item: ReturnType<typeof questions.create>
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'questions',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'questions', teamId: env.teamId })
  item = questions.create(env.db, {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: seedRegisteredConversation(env.db, env.paths, agent.id).id,
    turnId: randomUUID(),
    toolCallId: 'ask',
    binding: { route: 'web' },
    question: { prompt: 'PRIVATE_QUESTION', choices: [{ label: 'Text' }, { label: 'JSON' }] },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})
function holdEdges() {
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'approval_required' WHERE team_id = ?", [
    env.teamId,
  ])
}
test('offline staged restore cancels a question hold once while preserving the source', () => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  const path = join(env.home, 'question-restore.db')
  env.db.raw.run('VACUUM INTO ?', [path])
  pauseRestoredUserQueue(path)
  pauseRestoredUserQueue(path)
  const restored = openDb(path)
  try {
    const approval = approvals.get(restored, result.approvalId, true)
    if (!approval || !('events' in approval)) throw new Error('Missing restored hold')
    expect(approval.status).toBe('cancelled')
    expect(approval.events.filter((event) => event.event === 'cancelled')).toHaveLength(1)
    expect(detail(result.approvalId).status).toBe('pending')
  } finally {
    restored.close()
  }
})
function detail(id: string): CommunicationApprovalDetail {
  const approval = approvals.get(env.db, id, true)
  if (!approval || !('payload' in approval)) throw new Error('Missing detail')
  return approval
}
test('delivery hold binds one reference without exposing question content in the approval', () => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  const approval = detail(result.approvalId)
  expect(approval.expiresAt).toBe(item.expiresAt)
  const snapshot = questions.approvalSnapshot(env.db, item.agentId, item.id)
  expect(validateQuestionApproval(approval, snapshot).kind).toBe('question_delivery')
  expect(JSON.stringify(approval.payload)).not.toContain('PRIVATE_QUESTION')
  expect(snapshot?.question.deliveredAt).toBeNull()
  expect(() => questions.markDelivered(env.db, item.agentId, item.id)).toThrow()
  expect(() =>
    questions.markDelivered(env.db, item.agentId, item.id, Date.now(), approval.id),
  ).toThrow()
  expect(authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')).toEqual(
    result,
  )
  env.db.raw.run("UPDATE team_policy_edges SET posture = 'allow' WHERE team_id = ?", [env.teamId])
  expect(authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')).toEqual(
    result,
  )
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM communication_approvals').get()
      ?.n,
  ).toBe(1)
})
test('question approval expires at its source deadline and cannot then be claimed', () => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  expect(approvals.expirePending(env.db, item.expiresAt)).toBe(1)
  expect(detail(result.approvalId).status).toBe('expired')
  expect(() =>
    approvals.claimDelivery(
      env.db,
      result.approvalId,
      'operator',
      () => {
        throw new Error('An expired hold must never reach policy revalidation')
      },
      item.expiresAt,
    ),
  ).toThrow('approval_state_conflict')
})
test('failed cancellation audit rolls back question closure and its approval together', () => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  env.db.raw.exec(`CREATE TRIGGER reject_question_cancel BEFORE INSERT ON communication_approval_events
    WHEN NEW.event = 'cancelled' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END`)
  expect(() => questions.close(env.db, item.agentId, item.id, 'cancelled')).toThrow(
    'injected audit failure',
  )
  expect(questions.get(env.db, item.agentId, item.id)?.status).toBe('pending')
  expect(detail(result.approvalId).status).toBe('pending')
  env.db.raw.exec('DROP TRIGGER reject_question_cancel')
})
test.each([
  'close',
  'turn',
  'restart',
] as const)('question %s retires its pending approval with one canonical audit event', (mode) => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  const close = () =>
    mode === 'close'
      ? questions.close(env.db, item.agentId, item.id, 'cancelled')
      : mode === 'turn'
        ? questions.closeTurn(env.db, item.turnId, 'worker_lost')
        : questions.recoverInterrupted(env.db)
  close()
  close()
  const approval = detail(result.approvalId)
  expect(approval.status).toBe('cancelled')
  expect(approval.events.filter((event) => event.event === 'cancelled')).toHaveLength(1)
})
test('held answer stays immutable and unaccepted; another client cannot substitute its content', () => {
  questions.markDelivered(env.db, item.agentId, item.id)
  holdEdges()
  const response = {
    requestId: randomUUID(),
    conversationId: item.conversationId,
    answer: { kind: 'text' as const, text: 'PRIVATE_ANSWER' },
  }
  const result = authorizeQuestionBoundary(
    env.db,
    item.agentId,
    item.id,
    'question_answer',
    response,
  )
  if (result.kind !== 'held') throw new Error('Expected hold')
  const snapshot = questions.approvalSnapshot(env.db, item.agentId, item.id)
  expect(snapshot?.question).toMatchObject({
    status: 'pending',
    answer: null,
    responseRequestId: null,
  })
  expect(snapshot?.proposal).toEqual(response)
  expect(questions.answer(env.db, item.agentId, item.id, response).kind).toBe('conflict')
  expect(
    questions.answer(env.db, item.agentId, item.id, response, Date.now(), result.approvalId).kind,
  ).toBe('conflict')
  expect(validateQuestionApproval(detail(result.approvalId), snapshot).kind).toBe('question_answer')
  expect(JSON.stringify(detail(result.approvalId).payload)).not.toContain('PRIVATE_ANSWER')
  expect(
    authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_answer', response),
  ).toEqual(result)
  expect(
    authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_answer', {
      ...response,
      answer: { kind: 'skip' },
    }),
  ).toEqual({ kind: 'conflict' })
})
test('unreleased delivery and expired question cannot reserve an answer or capture another approval', () => {
  const response = {
    requestId: randomUUID(),
    conversationId: item.conversationId,
    answer: { kind: 'skip' as const },
  }
  expect(
    authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_answer', response),
  ).toEqual({ kind: 'conflict' })
  questions.markDelivered(env.db, item.agentId, item.id)
  expect(
    authorizeQuestionBoundary(
      env.db,
      item.agentId,
      item.id,
      'question_answer',
      response,
      item.expiresAt,
    ),
  ).toEqual({ kind: 'conflict' })
  expect(questions.approvalSnapshot(env.db, item.agentId, item.id)?.proposal).toBeNull()
})
test('complete approval tuple rejects forged endpoints, identity, channel and content digest', () => {
  holdEdges()
  const result = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (result.kind !== 'held') throw new Error('Expected hold')
  const approval = detail(result.approvalId)
  const snapshot = questions.approvalSnapshot(env.db, item.agentId, item.id)
  for (const patch of [
    { id: randomUUID() },
    { attemptId: 'different' },
    { origin: 'http_chat' },
    { operation: 'user_to_agent' },
    { channel: 'peer' },
    { targetTeamId: 'other' },
    { source: { kind: 'agent', id: 'other' } },
    { payload: { ...(approval.payload as object), inputDigest: '0'.repeat(64) } },
    { payload: { ...(approval.payload as object), extra: 'forged' } },
  ])
    expect(() =>
      validateQuestionApproval({ ...approval, ...patch } as CommunicationApprovalDetail, snapshot),
    ).toThrow()
})
test('denial preserves canonical block evidence without granting delivery', () => {
  env.db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [env.teamId])
  expect(() =>
    authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery'),
  ).toThrow()
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM team_policy_block_events').get()
      ?.n,
  ).toBe(1)
  expect(questions.get(env.db, item.agentId, item.id)?.deliveredAt).toBeNull()
})
test('only a canonical delivering claim can release the captured delivery and exact answer', () => {
  holdEdges()
  const delivery = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery')
  if (delivery.kind !== 'held') throw new Error('Expected hold')
  const claim = (id: string) =>
    approvals.claimDelivery(env.db, id, 'test', (row) =>
      authorizeInSnapshot(env.db, {
        source: row.source,
        target: row.target,
        origin: row.origin,
        attemptKind: row.attemptKind,
        attemptId: row.attemptId,
      }),
    )
  claim(delivery.approvalId)
  expect(
    questions.markDelivered(env.db, item.agentId, item.id, Date.now(), delivery.approvalId)
      .deliveredAt,
  ).not.toBeNull()
  approvals.finishDelivery(env.db, delivery.approvalId, true, 'test')
  const response = {
    requestId: randomUUID(),
    conversationId: item.conversationId,
    answer: { kind: 'text' as const, text: '\t'.repeat(4095) + 'x' },
  }
  const held = authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_answer', response)
  if (held.kind !== 'held') throw new Error('Expected hold')
  const captured = detail(held.approvalId)
  expect(
    validateQuestionApproval(captured, questions.approvalSnapshot(env.db, item.agentId, item.id))
      .kind,
  ).toBe('question_answer')
  claim(held.approvalId)
  expect(
    questions.answer(
      env.db,
      item.agentId,
      item.id,
      { ...response, answer: { kind: 'skip' } },
      Date.now(),
      held.approvalId,
    ).kind,
  ).toBe('conflict')
  expect(
    questions.answer(env.db, item.agentId, item.id, response, Date.now(), held.approvalId).kind,
  ).toBe('accepted')
  approvals.finishDelivery(env.db, held.approvalId, true, 'test')
  expect(questions.answer(env.db, item.agentId, item.id, response).kind).toBe('already_applied')
  expect(questions.get(env.db, item.agentId, item.id)?.continuation).toBe('unconfirmed')
})
test('failure to link a captured approval rolls back its owner record atomically', () => {
  holdEdges()
  const link = vi.spyOn(questions, 'linkApproval').mockImplementation(() => {
    throw new Error('storage fault')
  })
  try {
    expect(() =>
      authorizeQuestionBoundary(env.db, item.agentId, item.id, 'question_delivery'),
    ).toThrow('storage fault')
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM communication_approvals').get()
        ?.n,
    ).toBe(0)
    expect(questions.get(env.db, item.agentId, item.id)?.deliveryApprovalId).toBeNull()
  } finally {
    link.mockRestore()
  }
})
