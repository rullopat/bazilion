import type { TriggerDispatch } from '@bazilion/api-types'
import { type ComponentType, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

const loaderData = vi.hoisted(() => ({
  current: { triggers: [] as unknown[], dispatches: [] as unknown[] },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useLoaderData: () => loaderData.current,
  }),
  getRouteApi: () => ({
    useLoaderData: () => ({ agent: { id: 'agent-1', name: 'Scheduler agent' } }),
  }),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: () => vi.fn() }) }),
}))

vi.mock('../src/lib/daemon-client.ts', () => ({ daemonClient: vi.fn() }))

import { Route } from '../src/routes/agents/$id/triggers.tsx'

test('the triggers page shows each recent run with its status and error', () => {
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
  loaderData.current = { triggers: [], dispatches: [failed] }

  const page = (Route as unknown as { component: ComponentType }).component
  const html = renderToStaticMarkup(createElement(page))

  expect(html).toContain('<code>failed</code>')
  expect(html).toContain('provider unavailable')
})
