// The tab's title names the page and, in front, how many things wait on the operator.
import { expect, test } from 'vitest'
import { attentionCounts } from '../src/lib/attention-count.tsx'
import { documentTitle } from '../src/lib/page-title.tsx'

test('the tab names the page, most specific first, and counts what waits', () => {
  expect(documentTitle(null, 0)).toBe('bazilion')
  expect(documentTitle('Mira · Launch', 0)).toBe('Mira · Launch — bazilion')
  expect(documentTitle('Models · Setup', 2)).toBe('(2) Models · Setup — bazilion')
  expect(documentTitle(null, 1)).toBe('(1) bazilion')
  expect(documentTitle('Overview', 140)).toBe('(99+) Overview — bazilion')
})

test('the badge counts everything open; the title only what waits on you', () => {
  expect(
    attentionCounts({
      openTotal: 5,
      bySeverity: { action_required: 2, error: 2, warning: 1 },
      byKind: { agent_question: 1 } as never,
      degraded: [],
    }),
  ).toEqual({ open: 5, waiting: 2, agentWaits: 1 })
})
