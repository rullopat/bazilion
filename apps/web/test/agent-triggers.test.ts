import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    (options: Record<string, unknown>) => ({
      ...options,
      useLoaderData: vi.fn(),
    }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: () => vi.fn(),
    }),
  }),
}))

vi.mock('../src/lib/daemon-client.ts', () => ({ daemonClient: vi.fn() }))

import { Route } from '../src/routes/agents/$id/triggers.tsx'

test('agent trigger page renders recent dispatch status, attempts, and error diagnostics', () => {
  const route = Route as unknown as {
    component: ComponentType
    useLoaderData: ReturnType<typeof vi.fn>
  }
  route.useLoaderData.mockReturnValue({
    resolved: {
      agent: { id: 'agent-1', name: 'Scheduler agent', status: 'idle' },
    },
    triggers: [],
    dispatches: [
      {
        id: 'dispatch-1',
        triggerId: 'trigger-1',
        agentId: 'agent-1',
        scheduledAt: Date.UTC(2026, 7, 1, 10, 0),
        status: 'retrying',
        attemptCount: 2,
        nextAttemptAt: Date.UTC(2026, 7, 1, 10, 1),
        leaseExpiresAt: null,
        startedAt: Date.UTC(2026, 7, 1, 10, 0),
        finishedAt: null,
        lastError: 'provider unavailable',
        createdAt: Date.UTC(2026, 7, 1, 10, 0),
        updatedAt: Date.UTC(2026, 7, 1, 10, 0),
      },
    ],
  })

  const html = renderToStaticMarkup(createElement(route.component))

  expect(html).toContain('Recent dispatches')
  expect(html).toContain('<code>retrying</code>')
  expect(html).toContain('<td>2</td>')
  expect(html).toContain('provider unavailable')
})
