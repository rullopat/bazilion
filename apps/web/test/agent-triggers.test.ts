import type { TriggerDispatch } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { SchedulesView } from '../src/components/agent/AgentSchedules.tsx'

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
      onChanged: async () => {},
    }),
  )

  expect(html).toContain('<code>failed</code>')
  expect(html).toContain('provider unavailable')
})
