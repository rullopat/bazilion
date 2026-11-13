import type { ListAgentLoopBreaksResponse, ListInboxResponse, Message } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows } from '../command-helpers.ts'

const messageArg = positional('Message id')

function decodeText(payload: string): string {
  try {
    const obj = JSON.parse(payload) as { text?: unknown }
    if (typeof obj.text === 'string') return obj.text
  } catch {}
  return payload
}

function messageRow(m: Message): string[] {
  const when = new Date(m.createdAt).toISOString()
  const state = m.readAt ? 'read' : 'NEW'
  const text = decodeText(m.payload)
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
  return [m.id, state, when, `from:${m.fromAgentId.slice(0, 8)}`, `"${preview}"`]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List messages in an agent inbox' },
  args: {
    agent: positional('Recipient agent id or prefix'),
    unread: { type: 'boolean', description: 'Only show unread messages' },
  },
  async run({ args }) {
    const { messages } = await createClient().get<ListInboxResponse>(
      `${apiPath('agents', args.agent, 'messages')}${args.unread ? '?unread=1' : ''}`,
    )
    printRows(messages.map(messageRow), args.unread ? '(no unread messages)' : '(inbox empty)')
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a single message in full' },
  args: { id: messageArg },
  async run({ args }) {
    const m = await createClient().get<Message>(apiPath('messages', args.id))
    const when = new Date(m.createdAt).toISOString()
    const read = m.readAt ? new Date(m.readAt).toISOString() : '(unread)'
    console.log(`id:        ${m.id}`)
    console.log(`from:      ${m.fromAgentId}`)
    console.log(`to:        ${m.toAgentId}`)
    console.log(`created:   ${when}`)
    console.log(`read:      ${read}`)
    if (m.replyTo) console.log(`reply_to:  ${m.replyTo}`)
    console.log('')
    console.log(decodeText(m.payload))
  },
})

const readCmd = defineCommand({
  meta: { name: 'read', description: 'Mark a message as read' },
  args: { id: messageArg },
  async run({ args }) {
    await createClient().patch<Message>(apiPath('messages', args.id), { read: true })
    console.log(`marked read: ${args.id}`)
  },
})

const loopBreaksCmd = defineCommand({
  meta: { name: 'loop-breaks', description: 'List stopped agent-message chains' },
  args: {
    agent: agentArg,
    limit: { type: 'string', description: 'Maximum events to show (default 25)' },
  },
  async run({ args }) {
    const limit = args.limit ? `?limit=${encodeURIComponent(args.limit)}` : ''
    const { events } = await createClient().get<ListAgentLoopBreaksResponse>(
      `${apiPath('agents', args.agent, 'loop-breaks')}${limit}`,
    )
    printRows(
      events.map((event) => [
        new Date(event.createdAt).toISOString(),
        `chain:${event.causalChainId.slice(0, 8)}`,
        `${event.fromAgentId.slice(0, 8)}→${event.toAgentId.slice(0, 8)}`,
        `hop:${event.attemptedHop}/${event.maxHops}`,
        event.reason,
      ]),
      '(no agent-message chains stopped)',
    )
  },
})

export const inboxCommand = defineCommand({
  meta: { name: 'inbox', description: 'Inspect agent inboxes' },
  subCommands: {
    list: listCmd,
    show: showCmd,
    read: readCmd,
    'loop-breaks': loopBreaksCmd,
  },
})
