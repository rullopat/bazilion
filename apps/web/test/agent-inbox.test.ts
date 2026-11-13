import type { Message } from '@bazilion/api-types'
import { type ComponentType, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

const unread: Message = {
  id: 'message-1',
  fromAgentId: 'agent-2',
  toAgentId: 'agent-1',
  replyTo: null,
  causalChainId: 'chain-1',
  causalHop: 0,
  payload: JSON.stringify({ text: 'hello' }),
  createdAt: Date.UTC(2026, 7, 1, 10, 0),
  readAt: null,
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useLoaderData: () => ({
      messages: [unread],
      unreadCount: 1,
      selected: unread,
      agentNames: { 'agent-1': 'Ann', 'agent-2': 'Bob' },
      senders: [{ id: 'agent-2', name: 'Bob' }],
      loopBreaks: [],
    }),
    useSearch: () => ({}),
  }),
  getRouteApi: () => ({
    useLoaderData: () => ({ agent: { id: 'agent-1', name: 'Ann' } }),
  }),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: () => vi.fn() }) }),
}))

vi.mock('../src/lib/daemon-client.ts', () => ({ daemonClient: vi.fn() }))

import { Route } from '../src/routes/agents/$id/inbox.tsx'

test('the inbox page can mark an unread message read and send a message as another Agent', () => {
  const page = (Route as unknown as { component: ComponentType }).component
  const html = renderToStaticMarkup(createElement(page))

  expect(html).toContain('Mark read')
  expect(html).toContain('Send a message to this Agent')
  expect(html).toContain('Bob (agent-2)')
})
