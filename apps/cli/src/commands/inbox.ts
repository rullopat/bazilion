import type { ListInboxResponse, Message } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

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
    agent: { type: 'positional', required: true, description: 'Recipient agent id' },
    unread: { type: 'boolean', description: 'Only show unread messages' },
  },
  async run({ args }) {
    const client = createClient()
    const qs = args.unread ? '?unread=1' : ''
    const { messages } = await client.get<ListInboxResponse>(
      `/api/agents/${args.agent}/messages${qs}`,
    )
    if (messages.length === 0) {
      console.log(args.unread ? '(no unread messages)' : '(inbox empty)')
      return
    }
    for (const line of columnize(messages.map(messageRow))) console.log(line)
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show a single message in full' },
  args: {
    id: { type: 'positional', required: true, description: 'Message id' },
  },
  async run({ args }) {
    const client = createClient()
    const m = await client.get<Message>(`/api/messages/${args.id}`)
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
  args: {
    id: { type: 'positional', required: true, description: 'Message id' },
  },
  async run({ args }) {
    const client = createClient()
    await client.patch<Message>(`/api/messages/${args.id}`, { read: true })
    console.log(`marked read: ${args.id}`)
  },
})

export const inboxCommand = defineCommand({
  meta: { name: 'inbox', description: 'Inspect agent inboxes' },
  subCommands: {
    list: listCmd,
    show: showCmd,
    read: readCmd,
  },
})
