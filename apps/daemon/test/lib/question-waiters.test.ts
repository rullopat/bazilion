import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as questions from '../../src/core/repos/questions.ts'
import { QuestionWaiters } from '../../src/lib/question-waiters.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let item: ReturnType<typeof questions.create>
let registry: QuestionWaiters
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'wait', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'wait', teamId: env.teamId })
  item = questions.create(env.db, {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: seedRegisteredConversation(env.db, env.paths, agent.id).id,
    turnId: randomUUID(),
    toolCallId: 'ask',
    question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    binding: { route: 'web' },
    deadline: 2000,
  })
  registry = new QuestionWaiters(env.db)
})
afterEach(() => {
  registry.closeTurn(item.turnId)
  env.cleanup()
  vi.useRealTimers()
})
test('holds do not wake; committed answers wake once and remain unconfirmed', async () => {
  const waiter = registry.wait(item, new AbortController().signal)
  expect(() => registry.wait(item, new AbortController().signal)).toThrow()
  registry.settled(item.agentId, item.id)
  expect(registry.has(item.agentId, item.id)).toBe(true)
  const response = {
    requestId: randomUUID(),
    conversationId: item.conversationId,
    answer: { kind: 'text' as const, text: 'CSV' },
  }
  questions.answer(env.db, item.agentId, item.id, response)
  registry.settled('other-agent', item.id)
  expect(registry.has(item.agentId, item.id)).toBe(true)
  registry.settled(item.agentId, item.id)
  registry.settled(item.agentId, item.id)
  expect(await waiter).toMatchObject({
    questionId: item.id,
    kind: 'answer',
    answer: response.answer,
  })
  expect(registry.has(item.agentId, item.id)).toBe(false)
  expect(questions.get(env.db, item.agentId, item.id)?.continuation).toBe('unconfirmed')
  expect(() => registry.wait(item, new AbortController().signal)).toThrow()
})
test('deadline returns typed no-answer without replay', async () => {
  const waiter = registry.wait(item, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await waiter).toMatchObject({ kind: 'no_answer', reason: 'expired' })
  expect(registry.has(item.agentId, item.id)).toBe(false)
})
test('worker loss cancels a waiter and leaves no timer or answerable continuation', async () => {
  const waiter = registry.wait(item, new AbortController().signal)
  registry.closeTurn(item.turnId)
  expect(await waiter).toMatchObject({ kind: 'no_answer', reason: 'worker_lost' })
  expect(vi.getTimerCount()).toBe(0)
  expect(questions.get(env.db, item.agentId, item.id)?.continuation).toBe('interrupted')
})
test('a signal aborted before registration cannot strand a waiter', async () => {
  const controller = new AbortController()
  controller.abort()
  expect(await registry.wait(item, controller.signal)).toMatchObject({
    kind: 'no_answer',
    reason: 'cancelled',
  })
  expect(vi.getTimerCount()).toBe(0)
})
