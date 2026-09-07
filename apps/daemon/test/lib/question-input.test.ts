import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  parseQuestionInput,
  parseQuestionResponse,
  QUESTION_LIMITS,
} from '../../src/lib/question-input.ts'

const input = {
  prompt: 'Which output format?',
  choices: [{ label: 'Markdown', description: 'Readable text' }, { label: 'JSON' }],
  recommendedIndex: 0,
}
test('content is copied without authority fields and recommendation never becomes an answer', () => {
  const parsed = parseQuestionInput(input)
  expect(parsed).toEqual(input)
  expect(parsed.choices).not.toBe(input.choices)
  for (const field of ['agentId', 'teamId', 'questionId', 'recipient', 'deadline', 'approvalId']) {
    expect(() => parseQuestionInput({ ...input, [field]: 'forged' })).toThrow()
  }
  expect(() =>
    parseQuestionInput({ ...input, choices: [{ label: 'A', id: 'forged' }, { label: 'B' }] }),
  ).toThrow()
  expect(() =>
    parseQuestionResponse(
      { requestId: randomUUID(), conversationId: randomUUID() },
      parsed,
      randomUUID(),
    ),
  ).toThrow()
})
test('UTF-8 limits, choice uniqueness and indices reject ambiguous or oversized questions', () => {
  expect(
    parseQuestionInput({ ...input, prompt: 'é'.repeat(QUESTION_LIMITS.promptBytes / 2) }),
  ).toBeTruthy()
  for (const patch of [
    { prompt: 'é'.repeat(QUESTION_LIMITS.promptBytes / 2 + 1) },
    { prompt: '\u0000private' },
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
test('answers bind the exact conversation and explicit choice, text or Skip only', () => {
  const conversationId = randomUUID()
  const base = { requestId: randomUUID(), conversationId }
  for (const answer of [
    { kind: 'choice', index: 1 },
    { kind: 'text', text: 'Custom format' },
    { kind: 'skip' },
  ]) {
    expect(parseQuestionResponse({ ...base, answer }, input, conversationId)).toEqual({
      ...base,
      answer,
    })
  }
  for (const answer of [
    { kind: 'choice', index: 2 },
    { kind: 'choice', index: -1 },
    { kind: 'choice', index: 0.5 },
    { kind: 'choice', index: '1' },
    { kind: 'skip', approved: true },
    { kind: 'text', text: '  ' },
    { kind: 'text', text: 'é'.repeat(2049) },
    { kind: 'allow' },
  ])
    expect(() => parseQuestionResponse({ ...base, answer }, input, conversationId)).toThrow()
  expect(() =>
    parseQuestionResponse({ ...base, answer: { kind: 'skip' } }, input, randomUUID()),
  ).toThrow()
  expect(() =>
    parseQuestionResponse(
      { ...base, requestId: 'invalid', answer: { kind: 'skip' } },
      input,
      conversationId,
    ),
  ).toThrow()
})
