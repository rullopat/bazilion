import type { TriggerDispatch } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { nextRunWords, SchedulesView } from '../src/components/agent/AgentSchedules.tsx'

test('the schedules sheet shows each recent run with its status and error', () => {
  const failed: TriggerDispatch = {
    id: 'dispatch-1',
    triggerId: 'trigger-1',
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    scheduledAt: Date.UTC(2026, 7, 1, 10, 0),
    status: 'failed',
    startedAt: Date.UTC(2026, 7, 1, 10, 0),
    finishedAt: Date.UTC(2026, 7, 1, 10, 1),
    error: 'provider unavailable',
  }

  const html = renderToStaticMarkup(
    createElement(SchedulesView, {
      agentId: 'agent-1',
      triggers: [],
      dispatches: [failed],
      nextRuns: {},
      schedulerOff: false,
      onChanged: async () => {},
    }),
  )

  expect(html).toContain('Failed')
  expect(html).toContain('provider unavailable')
  // A run of a schedule that was deleted since still says what it was.
  expect(html).toContain('A deleted schedule')
})

test('a schedule reads as words, its message under it, and nothing internal shows', () => {
  const html = renderToStaticMarkup(
    createElement(SchedulesView, {
      agentId: 'agent-1',
      agentName: 'Mira',
      triggers: [
        {
          id: 'c9ae96b1-7f0d-478c-a42e-a7f914b44899',
          agentId: 'agent-1',
          kind: 'cron',
          intervalSec: null,
          cronExpr: '0 9 * * 1-5',
          message: 'Morning check',
          enabled: true,
          lastFiredAt: null,
          createdAt: 0,
        },
      ],
      dispatches: [],
      nextRuns: {},
      schedulerOff: true,
      onChanged: async () => {},
    }),
  )
  expect(html).toContain('No schedule runs on this daemon')
  expect(html).toContain('Weekdays at 09:00')
  expect(html).toContain('Morning check')
  expect(html).toContain('Has not run yet')
  expect(html).toContain('role="switch"')
  expect(html).not.toContain('c9ae96b1')
  expect(html).not.toContain('0 9 * * 1-5')
})

test('the next run reads in words', () => {
  const now = Date.UTC(2026, 10, 23, 8, 0)
  expect(nextRunWords(now + 20_000, now)).toBe('Next run now')
  expect(nextRunWords(now + 5 * 60_000, now)).toBe('Next run in 5 min')
  expect(nextRunWords(now + 26 * 3_600_000, now)).toMatch(/^Next run \S/)
})
