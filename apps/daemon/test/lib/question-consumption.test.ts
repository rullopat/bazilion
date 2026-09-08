import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as questions from '../../src/core/repos/questions.ts'
import { verifyQuestionConsumption } from '../../src/lib/question-consumption.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let item: ReturnType<typeof questions.create>
let target: ReturnType<typeof seedRegisteredConversation>
let filename: string
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'proof', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, { profileId: 'proof', teamId: env.teamId })
  target = seedRegisteredConversation(env.db, env.paths, agent.id)
  filename = join(env.paths.agentDir(agent.id), 'sessions', target.filename)
  item = questions.create(env.db, {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: target.id,
    turnId: randomUUID(),
    toolCallId: 'question-tool',
    question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    binding: { route: 'web' },
    deadline: Date.now() + 60_000,
  })
  questions.answer(env.db, agent.id, item.id, {
    requestId: randomUUID(),
    conversationId: target.id,
    answer: { kind: 'choice', index: 1 },
  })
  const accepted = questions.get(env.db, agent.id, item.id)
  if (!accepted) throw new Error('Question fixture disappeared')
  item = accepted
})
afterEach(() => env.cleanup())

function append(message: unknown) {
  appendFileSync(filename, `${JSON.stringify({ type: 'message', id: randomUUID(), message })}\n`)
}
function call() {
  append({
    role: 'assistant',
    content: [
      { type: 'toolCall', id: item.toolCallId, name: 'ask_user', arguments: item.question },
    ],
  })
}
function result(overrides: Record<string, unknown> = {}) {
  append({
    role: 'toolResult',
    toolCallId: item.toolCallId,
    toolName: 'ask_user',
    isError: false,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          questionId: item.id,
          question: item.question,
          kind: 'answer',
          answer: item.answer,
          ...overrides,
        }),
      },
    ],
  })
}
test('acceptance and a saved call alone do not prove consumption', () => {
  expect(() => verifyQuestionConsumption(env.paths, item, target)).toThrow('not been persisted')
  call()
  expect(() => verifyQuestionConsumption(env.paths, item, target)).toThrow('not been persisted')
  result()
  expect(() => verifyQuestionConsumption(env.paths, item, target)).not.toThrow()
  expect(questions.get(env.db, item.agentId, item.id)?.continuation).toBe('unconfirmed')
})
test('rejects a different answer or question identity in the persisted result', () => {
  call()
  result({ questionId: randomUUID() })
  expect(() => verifyQuestionConsumption(env.paths, item, target)).toThrow('answer differs')
})
test('rejects results preceding their call and a different conversation', () => {
  result()
  call()
  expect(() => verifyQuestionConsumption(env.paths, item, target)).toThrow('binding differs')
  expect(() => verifyQuestionConsumption(env.paths, item, { ...target, id: randomUUID() })).toThrow(
    'no consumable outcome',
  )
})
test('rejects duplicate transcript results rather than treating them as a second consumption', () => {
  call()
  result()
  result()
  expect(() => verifyQuestionConsumption(env.paths, item, target)).toThrow('binding differs')
})

test('reused provider tool IDs in an earlier turn cannot prove or prevent current consumption', () => {
  call()
  result({ questionId: 'earlier-question' })
  const turnStartEntry = 3 // session header plus the previous turn's call and result
  expect(() => verifyQuestionConsumption(env.paths, item, target, turnStartEntry)).toThrow(
    'not been persisted',
  )
  call()
  result()
  expect(() => verifyQuestionConsumption(env.paths, item, target, turnStartEntry)).not.toThrow()
})
