import { expect, test } from 'vitest'
import { buildReviewDigest } from '../../src/lib/review-digest.ts'

test('digest keeps the newest bounded user turns and redacts secrets', () => {
  const digest = buildReviewDigest(
    [
      { sessionId: 's', ordinal: 0, role: 'user', text: 'old' },
      { sessionId: 's', ordinal: 1, role: 'assistant', text: 'old answer' },
      { sessionId: 's', ordinal: 2, role: 'user', text: 'token=secret-value' },
      { sessionId: 's', ordinal: 3, role: 'assistant', text: 'new answer' },
    ],
    { maxUserTurns: 1 },
  )
  expect(digest).toMatchObject({ startOrdinal: 2, endOrdinal: 3, turnsReviewed: 1 })
  expect(digest?.entries.map((entry) => entry.text)).toEqual(['[REDACTED]', 'new answer'])
})

test('digest drops sensitive entries and never replays tool payloads', () => {
  const digest = buildReviewDigest([
    { sessionId: 's', ordinal: 0, role: 'user', text: 'work' },
    { sessionId: 's', ordinal: 1, role: 'tool', toolName: 'bash', text: 'private log dump' },
    { sessionId: 's', ordinal: 2, role: 'assistant', text: 'done' },
    {
      sessionId: 's',
      ordinal: 3,
      role: 'tool',
      toolName: 'secret',
      text: 'value',
      sensitive: true,
    },
  ])
  expect(digest?.entries.map((entry) => entry.text)).toEqual([
    'work',
    '[tool:bash] completed',
    'done',
  ])
})

test('character bound truncates from the oldest selected content', () => {
  const digest = buildReviewDigest(
    [
      { sessionId: 's', ordinal: 0, role: 'user', text: '12345' },
      { sessionId: 's', ordinal: 1, role: 'assistant', text: '67890' },
    ],
    { maxCharacters: 7 },
  )
  expect(digest?.inputCharacters).toBe(7)
  expect(digest?.entries.map((entry) => entry.text).join('')).toBe('4567890')
})
