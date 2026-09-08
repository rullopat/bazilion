import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { pauseRestoredUserQueue } from '../../../cli/src/backup-queue-recovery.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as questions from '../../src/core/repos/questions.ts'
import { QUESTION_LIMITS } from '../../src/lib/question-input.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv
let input: questions.QuestionCreation
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'question', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'question', teamId: env.teamId })
  input = {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: seedRegisteredConversation(env.db, env.paths, agent.id).id,
    turnId: randomUUID(),
    toolCallId: 'ask-1',
    binding: { route: 'web' },
    question: { prompt: 'Which format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
  }
})
afterEach(() => env.cleanup())
function response() {
  return {
    requestId: randomUUID(),
    conversationId: input.conversationId,
    answer: { kind: 'choice' as const, index: 1 },
  }
}
test('one pending question and immutable tool identity prevent duplicate waiters', () => {
  const item = questions.create(env.db, input, 100)
  expect(() => questions.create(env.db, { ...input, toolCallId: 'second' }, 100)).toThrow()
  questions.answer(env.db, input.agentId, item.id, response(), 101)
  expect(() => questions.create(env.db, input, 102)).toThrow()
  expect(questions.create(env.db, { ...input, toolCallId: 'second' }, 102).status).toBe('pending')
  expect(questions.list(env.db, input.agentId)).toHaveLength(2)
})
test('two replies and lost acknowledgement settle once without implying consumption', () => {
  const item = questions.create(env.db, input, 100)
  const first = response()
  expect(questions.answer(env.db, input.agentId, item.id, first, 101)).toMatchObject({
    kind: 'accepted',
    question: { status: 'answered', continuation: 'unconfirmed', consumedAt: null },
  })
  expect(questions.answer(env.db, input.agentId, item.id, response(), 102).kind).toBe('conflict')
  expect(questions.answer(env.db, input.agentId, item.id, first, 103).kind).toBe('already_applied')
  expect(
    questions.answer(env.db, input.agentId, item.id, { ...first, answer: { kind: 'skip' } }, 104)
      .kind,
  ).toBe('conflict')
  expect(
    questions.markConsumed(env.db, input.agentId, item.id, 'forged-turn', input.toolCallId, 105)
      .consumedAt,
  ).toBeNull()
  expect(
    questions.markConsumed(env.db, input.agentId, item.id, input.turnId, input.toolCallId, 106)
      .consumedAt,
  ).toBe(106)
  questions.closeTurn(env.db, input.turnId, 'worker_lost', 107)
  expect(questions.get(env.db, input.agentId, item.id)?.continuation).toBe('consumed')
})
test('deadline wins over a late answer and cannot be extended by a response', () => {
  const item = questions.create(env.db, { ...input, deadline: 200 }, 100)
  expect(item.expiresAt).toBe(200)
  expect(questions.answer(env.db, input.agentId, item.id, response(), 200)).toMatchObject({
    kind: 'conflict',
    question: { status: 'expired', noAnswerReason: 'expired', answer: null },
  })
  expect(() =>
    questions.create(env.db, { ...input, toolCallId: 'late', deadline: 100 }, 100),
  ).toThrow()
})
test('restart cancels waiters and preserves accepted but interrupted answers idempotently', () => {
  const accepted = questions.create(env.db, input, 100)
  const answer = response()
  questions.answer(env.db, input.agentId, accepted.id, answer, 101)
  const pending = questions.create(env.db, { ...input, toolCallId: 'pending' }, 102)
  questions.recoverInterrupted(env.db, 'daemon_restart', 103)
  expect(questions.get(env.db, input.agentId, pending.id)).toMatchObject({
    status: 'cancelled',
    noAnswerReason: 'daemon_restart',
    continuation: 'interrupted',
  })
  const record = questions.get(env.db, input.agentId, accepted.id)
  expect(record).toMatchObject({
    status: 'answered',
    answer: answer.answer,
    continuation: 'interrupted',
    consumedAt: null,
  })
  questions.recoverInterrupted(env.db, 'daemon_restart', 104)
  expect(questions.get(env.db, input.agentId, accepted.id)).toEqual(record)
  expect(
    questions.markConsumed(env.db, input.agentId, accepted.id, input.turnId, input.toolCallId, 105)
      .consumedAt,
  ).toBeNull()
})
test('scope and retention preserve live questions while terminal records expire', () => {
  expect(() => questions.create(env.db, { ...input, teamId: 'wrong' }, 100)).toThrow()
  expect(() => questions.create(env.db, { ...input, conversationId: randomUUID() }, 100)).toThrow()
  const item = questions.create(env.db, input, 100)
  expect(questions.get(env.db, 'wrong-agent', item.id)).toBeNull()
  questions.prune(env.db, 200 + QUESTION_LIMITS.terminalRetentionMs)
  expect(questions.get(env.db, input.agentId, item.id)).not.toBeNull()
  questions.closeTurn(env.db, input.turnId, 'worker_lost', 101)
  questions.prune(env.db, 200 + QUESTION_LIMITS.terminalRetentionMs)
  expect(questions.get(env.db, input.agentId, item.id)).toBeNull()
})
test('staged restore closes old questions without changing the source or losing an accepted answer', () => {
  const accepted = questions.create(env.db, input, 100)
  const submitted = response()
  questions.answer(env.db, input.agentId, accepted.id, submitted, 101)
  const pending = questions.create(env.db, { ...input, toolCallId: 'next' }, 102)
  const file = join(env.home, 'restored.db')
  env.db.raw.run('VACUUM INTO ?', [file])
  pauseRestoredUserQueue(file)
  const restored = openDb(file)
  try {
    expect(questions.get(restored, input.agentId, pending.id)).toMatchObject({
      status: 'cancelled',
      noAnswerReason: 'restored_backup',
    })
    expect(questions.get(restored, input.agentId, accepted.id)).toMatchObject({
      answer: submitted.answer,
      continuation: 'interrupted',
    })
    expect(questions.get(env.db, input.agentId, pending.id)?.status).toBe('pending')
    expect(questions.get(env.db, input.agentId, accepted.id)?.continuation).toBe('unconfirmed')
  } finally {
    restored.close()
  }
})
