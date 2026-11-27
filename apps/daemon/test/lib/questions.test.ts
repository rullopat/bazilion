import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  parseQuestionAnswer,
  parseQuestionInput,
  QUESTION_LIMITS,
  QuestionRegistry,
} from '../../src/lib/questions.ts'

const item = {
  prompt: 'Which output format?',
  choices: [{ label: 'Markdown', description: 'Readable text' }, { label: 'JSON' }],
  recommendedIndex: 0,
}
const input = { questions: [item] }
const context = () => ({ agentId: randomUUID(), conversationId: randomUUID() })

test('a question keeps its content, ignores unknown keys and rejects ambiguous or oversized input', () => {
  expect(parseQuestionInput({ ...input, recipient: 'someone-else' })).toEqual(input)
  expect(
    parseQuestionInput({
      questions: [{ ...item, prompt: 'x'.repeat(QUESTION_LIMITS.promptChars) }],
    }),
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
    expect(() => parseQuestionInput({ questions: [{ ...item, ...patch }] })).toThrow()
  for (const bad of [
    {},
    { questions: [] },
    { questions: [item], action: { reason: 'r', instructions: 'i' } },
  ])
    expect(() => parseQuestionInput(bad)).toThrow()
})

test('an answer is an existing choice, non-empty text or Skip, one per question', () => {
  for (const one of [
    { kind: 'choice', index: 1 },
    { kind: 'text', text: 'YAML' },
    { kind: 'skip' },
  ])
    expect(parseQuestionAnswer({ kind: 'answers', answers: [one] }, input)).toEqual({
      kind: 'answers',
      answers: [one],
    })
  expect(parseQuestionAnswer({ kind: 'skip' }, input)).toEqual({ kind: 'skip' })
  for (const one of [
    { kind: 'choice', index: 2 },
    { kind: 'choice', index: 0.5 },
    { kind: 'choice', index: '1' },
    { kind: 'choices', indexes: [0, 1] },
    { kind: 'text', text: '  ' },
    { kind: 'text', text: 'x'.repeat(QUESTION_LIMITS.answerChars + 1) },
    { kind: 'allow' },
    undefined,
  ])
    expect(() => parseQuestionAnswer({ kind: 'answers', answers: [one] }, input)).toThrow()
  // One answer per question, no more and no fewer.
  expect(() => parseQuestionAnswer({ kind: 'answers', answers: [] }, input)).toThrow(
    /one answer for each/,
  )
  expect(() => parseQuestionAnswer({ kind: 'done' }, input)).toThrow()
})

test('a question with several choices takes them together, in order and once each', () => {
  const card = {
    questions: [
      { ...item, multiple: true },
      { prompt: 'Why?', choices: [{ label: 'A' }, { label: 'B' }] },
    ],
  }
  expect(parseQuestionInput(card).questions?.[0]?.multiple).toBe(true)
  expect(
    parseQuestionAnswer(
      { kind: 'answers', answers: [{ kind: 'choices', indexes: [1, 0, 1] }, { kind: 'skip' }] },
      card,
    ),
  ).toEqual({ kind: 'answers', answers: [{ kind: 'choices', indexes: [0, 1] }, { kind: 'skip' }] })
})

test('the first answer wins and settles the waiting tool call once', async () => {
  const registry = new QuestionRegistry()
  const where = context()
  const { question, result } = registry.ask(where, input)
  expect(registry.list(where.agentId)).toEqual([question])
  expect(registry.list(randomUUID())).toEqual([])
  const pick = (index: number) => ({ kind: 'answers', answers: [{ kind: 'choice', index }] })
  expect(() => registry.answer(where.agentId, question.id, pick(9))).toThrow()
  expect(registry.answer(randomUUID(), question.id, { kind: 'skip' })).toBe(false)
  expect(registry.answer(where.agentId, question.id, pick(1))).toBe(true)
  expect(registry.answer(where.agentId, question.id, { kind: 'skip' })).toBe(false)
  expect(await result).toEqual({
    questionId: question.id,
    question: input,
    kind: 'answer',
    answers: [{ kind: 'choice', index: 1 }],
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

test('a card answered question by question settles once each question has an answer', async () => {
  const registry = new QuestionRegistry()
  const where = context()
  const card = {
    questions: [item, { prompt: 'Tone?', choices: [{ label: 'Calm' }, { label: 'Bold' }] }],
  }
  const { question, result } = registry.ask(where, card)
  expect(registry.answerOne(where.agentId, question.id, 1, { kind: 'choice', index: 0 })).toBe(true)
  expect(registry.get(question.id)?.answered).toEqual([null, { kind: 'choice', index: 0 }])
  expect(registry.answerOne(where.agentId, question.id, 0, { kind: 'text', text: 'YAML' })).toBe(
    true,
  )
  expect(await result).toMatchObject({
    kind: 'answer',
    answers: [
      { kind: 'text', text: 'YAML' },
      { kind: 'choice', index: 0 },
    ],
  })
})

test('an action does not hold the turn, waits until answered, and the answer wakes the Agent', async () => {
  const { _resetWakesForTest, takeWakes } = await import('../../src/lib/wakes.ts')
  _resetWakesForTest()
  const registry = new QuestionRegistry(20)
  const where = context()
  const turn = new AbortController()
  const asked = registry.ask(
    where,
    {
      action: {
        reason: 'Sign in to the shop',
        instructions: 'Log in, then come back.',
        url: 'https://shop.example',
      },
    },
    turn.signal,
  )
  expect(await asked.result).toMatchObject({ kind: 'action_asked' })
  expect(asked.question.expiresAt).toBeNull()
  // Neither the turn's end nor time ends it, and a question may still be asked beside it.
  turn.abort()
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(registry.get(asked.question.id)).toBeDefined()
  expect(() => registry.ask(where, input)).not.toThrow()
  expect(() =>
    registry.answer(where.agentId, asked.question.id, { kind: 'answers', answers: [] }),
  ).toThrow()
  expect(registry.answer(where.agentId, asked.question.id, { kind: 'done', note: 'All set' })).toBe(
    true,
  )
  expect(registry.get(asked.question.id)).toBeUndefined()
  const [wake] = takeWakes(where.agentId)
  expect(wake).toMatchObject({
    conversationId: where.conversationId,
    summary: 'The user did it: Sign in to the shop',
  })
  expect(wake?.text).toContain('Their note: All set')
  expect(() =>
    registry.ask(where, { action: { reason: 'r', instructions: 'i', url: 'javascript:alert(1)' } }),
  ).toThrow(/http/)
})
