import type { AgentQuestion } from '@bazilion/api-types'
import { afterEach, expect, test, vi } from 'vitest'
import { promptForQuestion, questionLines } from '../src/question-prompt.ts'

const item: AgentQuestion = {
  id: 'question',
  agentId: 'agent',
  conversationId: 'conversation',
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  question: {
    prompt: 'Format?\u001b[31m',
    choices: [{ label: 'Text' }, { label: 'JSON' }],
    recommendedIndex: 1,
  },
}
afterEach(() => vi.useRealTimers())
test('question list and chat prompt print model text with control characters escaped', () => {
  expect(
    questionLines({
      ...item,
      question: {
        prompt: 'Pick\u001b]0;title\u0007 one\nsecond line',
        choices: [{ label: 'A\u009b31m', description: 'why\r' }, { label: 'B' }],
        recommendedIndex: 1,
      },
    }),
  ).toEqual([
    'Pick\\x1b]0;title\\x07 one',
    'second line',
    '1. A\\x9b31m',
    '   why\\x0d',
    '2. B (recommended)',
  ])
})
test('terminal recommendations need explicit input and share a sequential prompt', async () => {
  const question = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('2')
  const write = vi.fn()
  expect(await promptForQuestion(item, { question, write })).toEqual({ kind: 'choice', index: 1 })
  expect(question).toHaveBeenCalledTimes(2)
  expect(write.mock.calls.flat().join('\n')).not.toContain('\u001b')
})
test('Other and Skip are explicit; EOF does not submit either', async () => {
  expect(
    await promptForQuestion(item, {
      question: vi.fn().mockResolvedValueOnce('o').mockResolvedValueOnce('CSV'),
      write: vi.fn(),
    }),
  ).toEqual({ kind: 'text', text: 'CSV' })
  expect(
    await promptForQuestion(item, { question: vi.fn().mockResolvedValue('s'), write: vi.fn() }),
  ).toEqual({ kind: 'skip' })
  expect(
    await promptForQuestion(item, {
      question: vi.fn().mockRejectedValue(new Error('EOF')),
      write: vi.fn(),
    }),
  ).toBeNull()
})
test('expiry aborts the one outstanding readline request and never becomes an answer', async () => {
  vi.useFakeTimers()
  const prompt = {
    write: vi.fn(),
    question: vi.fn(
      (_text: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('expired')), { once: true }),
        ),
    ),
  }
  const result = promptForQuestion({ ...item, expiresAt: Date.now() + 100 }, prompt)
  await vi.advanceTimersByTimeAsync(100)
  expect(await result).toBeNull()
  expect(prompt.question).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
