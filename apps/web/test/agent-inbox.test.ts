import type { Message } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { MailboxView, mailSenders } from '../src/components/agent/AgentMailbox.tsx'

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

test('the mailbox lists messages by who sent them, can mark them read and send as another Agent', () => {
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
  expect(html).toContain('From Bob')
  // Trying a teammate's message is offered, folded, after the mail itself.
  expect(html).toContain('Try a message from a teammate')
  expect(html.indexOf('Try a message from a teammate')).toBeGreaterThan(
    html.indexOf('Stopped chains'),
  )
  expect(html).not.toContain('role="combobox"')
  // An archived Agent cannot send, and the Agent does not write to itself.
  expect(
    mailSenders('agent-1', [
      { id: 'agent-1', name: 'Ann', status: 'idle' },
      { id: 'agent-2', name: 'Bob', status: 'idle' },
      { id: 'agent-3', name: 'Cyd', status: 'archived' },
    ]),
  ).toEqual([{ value: 'agent-2', label: 'Bob' }])
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

test('two Agents with one name are told apart by the start of their id', () => {
  const html = renderToStaticMarkup(
    createElement(MailboxView, {
      agent: { id: 'agent-1', name: 'Ann' },
      agents: [
        { id: 'agent-2aaaaaaa', name: 'Bob', status: 'idle' },
        { id: 'agent-3bbbbbbb', name: 'Bob', status: 'idle' },
      ],
      messages: [{ ...unread, fromAgentId: 'agent-2aaaaaaa' }],
      loopBreaks: [],
      onChanged: async () => {},
    }),
  )
  expect(html).toContain('From Bob (agent-2a)')
  expect(
    mailSenders('agent-1', [
      { id: 'agent-2aaaaaaa', name: 'Bob', status: 'idle' },
      { id: 'agent-3bbbbbbb', name: 'Bob', status: 'idle' },
    ]).map((sender) => sender.label),
  ).toEqual(['Bob (agent-2a)', 'Bob (agent-3b)'])
})
