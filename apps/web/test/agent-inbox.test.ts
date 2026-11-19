import type { Message } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { MailboxView } from '../src/components/agent/AgentMailbox.tsx'

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

test('the mailbox opens the newest unread message, can mark it read and send as another Agent', () => {
  const html = renderToStaticMarkup(
    createElement(MailboxView, {
      agent: { id: 'agent-1', name: 'Ann' },
      agents: [
        { id: 'agent-1', name: 'Ann', status: 'idle' },
        { id: 'agent-2', name: 'Bob', status: 'idle' },
        { id: 'agent-3', name: 'Cyd', status: 'archived' },
      ],
      messages: [unread],
      loopBreaks: [],
      onChanged: async () => {},
    }),
  )

  expect(html).toContain('Mark read')
  expect(html).toContain('hello')
  expect(html).toContain('Send a message to this Agent')
  expect(html).toContain('Bob (agent-2)')
  // An archived Agent cannot send, and the Agent does not write to itself.
  expect(html).not.toContain('Cyd (agent-3)')
  expect(html).not.toContain('Ann (agent-1)')
})

test('a mailbox with nothing unread opens no message', () => {
  const html = renderToStaticMarkup(
    createElement(MailboxView, {
      agent: { id: 'agent-1', name: 'Ann' },
      agents: [{ id: 'agent-2', name: 'Bob', status: 'idle' }],
      messages: [{ ...unread, readAt: Date.UTC(2026, 7, 1, 11, 0) }],
      loopBreaks: [],
      onChanged: async () => {},
    }),
  )

  expect(html).not.toContain('Mark read')
  expect(html).toContain('0 unread')
})
