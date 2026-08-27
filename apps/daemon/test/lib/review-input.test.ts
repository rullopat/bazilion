import { expect, test } from 'vitest'
import type { ReviewDigest } from '../../src/lib/review-digest.ts'
import { prepareReviewInput } from '../../src/lib/review-input.ts'

function digest(entries: ReviewDigest['entries']): ReviewDigest {
  return {
    sessionId: 'session-a',
    startOrdinal: entries[0]?.ordinal ?? 0,
    endOrdinal: entries.at(-1)?.ordinal ?? 0,
    inputCharacters: entries.reduce((total, entry) => total + entry.text.length, 0),
    turnsReviewed: 1,
    entries,
  }
}

test('review input bounds every context section and evidence to rendered entries', () => {
  const prepared = prepareReviewInput(
    digest([
      { sessionId: 'session-a', ordinal: 1, role: 'user', text: 'old'.repeat(20_000) },
      { sessionId: 'session-a', ordinal: 2, role: 'assistant', text: 'new evidence' },
    ]),
    ['private'.repeat(2_000), 'must-not-fit'],
    ['lessons/'.concat('x'.repeat(5_000)), 'must-not-fit'],
  )

  expect(prepared.message.length).toBeLessThan(55_000)
  expect(prepared.message).toContain('[session-a:2] ASSISTANT: new evidence')
  expect(prepared.evidence).toContainEqual({ sessionId: 'session-a', entryOrdinal: 2 })
  for (const item of prepared.evidence) {
    expect(prepared.message).toContain(`[${item.sessionId}:${item.entryOrdinal}]`)
  }
  expect(prepared.message).not.toContain('must-not-fit')
})

test('review input renders empty bounded context explicitly', () => {
  const prepared = prepareReviewInput(digest([]), [], [])
  expect(prepared.message).toContain('# Transcript digest\n\n(none)')
  expect(prepared.message).toContain('# Existing private lessons\n(none)')
  expect(prepared.message).toContain('# Existing shared lesson keys\n(none)')
  expect(prepared.evidence).toEqual([])
})
