import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  parseQuestionAnswer,
  parseQuestionInput,
  QUESTION_LIMITS,
  QuestionRegistry,
} from '../../src/lib/questions.ts'

const input = {
  prompt: 'Which output format?',
  choices: [{ label: 'Markdown', description: 'Readable text' }, { label: 'JSON' }],
  recommendedIndex: 0,
}
const context = () => ({ agentId: randomUUID(), conversationId: randomUUID() })

test('a question keeps its content, ignores unknown keys and rejects ambiguous or oversized input', () => {
  expect(parseQuestionInput({ ...input, recipient: 'someone-else' })).toEqual(input)
  expect(
    parseQuestionInput({ ...input, prompt: 'x'.repeat(QUESTION_LIMITS.promptChars) }),
  ).toBeTruthy()
  for (const patch of [
    { prompt: 'x'.repeat(QUESTION_LIMITS.promptChars + 1) },
    { prompt: '  ' },
    { choices: [{ label: 'Only' }] },
    { choices: Array.from({ length: 5 }, (_, i) => ({ label: String(i) })) },
    { choices: [{ label: 'Yes' }, { label: ' yes ' }] },
    { choices: [{ label: 'Ａ' }, { label: 'A' }] },
    { choices: [{ label: 'a'.repeat(121) }, { label: 'B' }] },
    { choices: [{ label: 'A', description: 'x'.repeat(501) }, { label: 'B' }] },
    { recommendedIndex: -1 },
    { recommendedIndex: 2 },
    { recommendedIndex: 0.5 },
  ])
    expect(() => parseQuestionInput({ ...input, ...patch })).toThrow()
})

test('an answer is an existing choice, non-empty text or Skip', () => {
  for (const answer of [
    { kind: 'choice', index: 1 },
    { kind: 'text', text: 'YAML' },
    { kind: 'skip' },
  ])
    expect(parseQuestionAnswer(answer, input)).toEqual(answer)
  for (const answer of [
    { kind: 'choice', index: 2 },
    { kind: 'choice', index: 0.5 },
    { kind: 'choice', index: '1' },
    { kind: 'text', text: '  ' },
    { kind: 'text', text: 'x'.repeat(QUESTION_LIMITS.answerChars + 1) },
    { kind: 'allow' },
    undefined,
  ])
    expect(() => parseQuestionAnswer(answer, input)).toThrow()
})

test('the first answer wins and settles the waiting tool call once', async () => {
  const registry = new QuestionRegistry()
  const where = context()
  const { question, result } = registry.ask(where, input)
  expect(registry.list(where.agentId)).toEqual([question])
  expect(registry.list(randomUUID())).toEqual([])
  expect(() => registry.answer(where.agentId, question.id, { kind: 'choice', index: 9 })).toThrow()
  expect(registry.answer(randomUUID(), question.id, { kind: 'skip' })).toBe(false)
  expect(registry.answer(where.agentId, question.id, { kind: 'choice', index: 1 })).toBe(true)
  expect(registry.answer(where.agentId, question.id, { kind: 'skip' })).toBe(false)
  expect(await result).toEqual({
    questionId: question.id,
    question: input,
    kind: 'answer',
    answer: { kind: 'choice', index: 1 },
  })
  expect(registry.list(where.agentId)).toEqual([])
  expect(registry.settled(question.id)).toBeUndefined()
})

test('Skip, the timeout and the end of the turn settle without an answer', async () => {
  const registry = new QuestionRegistry(20)
  const skipped = registry.ask(context(), input)
  registry.answer(skipped.question.agentId, skipped.question.id, { kind: 'skip' })
  expect(await skipped.result).toMatchObject({ kind: 'no_answer', reason: 'skipped' })

  const expired = registry.ask(context(), input)
  expect(await expired.result).toMatchObject({ kind: 'no_answer', reason: 'expired' })
  expect(registry.get(expired.question.id)).toBeUndefined()

  const turn = new AbortController()
  const cancelled = registry.ask(context(), input, turn.signal)
  turn.abort()
  expect(await cancelled.result).toMatchObject({ kind: 'no_answer', reason: 'cancelled' })
  expect(() => registry.ask(context(), input, turn.signal)).toThrow('turn has ended')
})

test('an Agent waits on one question at a time', () => {
  const registry = new QuestionRegistry()
  const where = context()
  registry.ask(where, input)
  expect(() => registry.ask(where, input)).toThrow('still waiting')
  expect(() => registry.ask(context(), input)).not.toThrow()
})
