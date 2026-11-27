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
    questions: [
      {
        prompt: 'Format?\u001b[31m',
        choices: [{ label: 'Text' }, { label: 'JSON' }],
        recommendedIndex: 1,
      },
    ],
  },
}
afterEach(() => vi.useRealTimers())
test('question list and chat prompt print model text with control characters escaped', () => {
  expect(
    questionLines({
      ...item,
      question: {
        questions: [
          {
            prompt: 'Pick\u001b]0;title\u0007 one\nsecond line',
            choices: [{ label: 'A\u009b31m', description: 'why\r' }, { label: 'B' }],
            recommendedIndex: 1,
          },
        ],
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
  expect(await promptForQuestion(item, { question, write })).toEqual({
    kind: 'answers',
    answers: [{ kind: 'choice', index: 1 }],
  })
  expect(question).toHaveBeenCalledTimes(2)
  expect(write.mock.calls.flat().join('\n')).not.toContain('\u001b')
})
test('Other and Skip are explicit; EOF does not submit either', async () => {
  expect(
    await promptForQuestion(item, {
      question: vi.fn().mockResolvedValueOnce('o').mockResolvedValueOnce('CSV'),
      write: vi.fn(),
    }),
  ).toEqual({ kind: 'answers', answers: [{ kind: 'text', text: 'CSV' }] })
  expect(
    await promptForQuestion(item, { question: vi.fn().mockResolvedValue('s'), write: vi.fn() }),
  ).toEqual({ kind: 'answers', answers: [{ kind: 'skip' }] })
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

test('a card of several questions is asked one by one; several choices take several numbers', async () => {
  const card: AgentQuestion = {
    ...item,
    question: {
      questions: [
        {
          prompt: 'Which?',
          choices: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
          multiple: true,
        },
        { prompt: 'Tone?', choices: [{ label: 'Calm' }, { label: 'Bold' }] },
      ],
    },
  }
  const question = vi.fn().mockResolvedValueOnce('1 3').mockResolvedValueOnce('2')
  expect(await promptForQuestion(card, { question, write: vi.fn() })).toEqual({
    kind: 'answers',
    answers: [
      { kind: 'choices', indexes: [0, 2] },
      { kind: 'choice', index: 1 },
    ],
  })
  expect(questionLines(card)[0]).toBe('(1/2) Which?')
})

test('an action is shown with the command that answers it, and nothing is asked', async () => {
  const action: AgentQuestion = {
    ...item,
    expiresAt: null,
    question: { action: { reason: 'Sign in', instructions: 'Open the shop and log in.' } },
  }
  const question = vi.fn()
  const write = vi.fn()
  expect(await promptForQuestion(action, { question, write })).toBeNull()
  expect(question).not.toHaveBeenCalled()
  expect(write.mock.calls.flat().join('\n')).toContain('--done')
})
