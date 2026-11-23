import {
  type Conversation,
  type ConversationListResponse,
  type ConversationSearchResponse,
  type ConversationUsage,
  type ProviderMessage,
  usageSummary,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import {
  agentArg,
  apiPath,
  jsonFlag,
  positional,
  printJson,
  terminalSafe,
} from '../command-helpers.ts'

const conversationArg = positional('Conversation id')

const list = defineCommand({
  meta: { name: 'list', description: 'List conversations; the active one receives new messages' },
  args: {
    agent: agentArg,
    limit: { type: 'string', default: '20', description: 'Page size' },
    offset: { type: 'string', default: '0', description: 'Conversations to skip' },
    json: jsonFlag,
  },
  async run({ args }) {
    const query = new URLSearchParams({ limit: args.limit, offset: args.offset })
    const body = await createClient().get<ConversationListResponse>(
      `${apiPath('agents', args.agent, 'conversations')}?${query}`,
    )
    if (args.json) return printJson(body)
    if (!body.total) return console.log('(no conversations)')
    for (const line of columnize([
      ['id', 'title', 'active', 'used'],
      ...body.conversations.map((item) => {
        const used = body.usage[item.id]
        return [
          item.id,
          item.title,
          item.id === body.selectedId ? 'yes' : '',
          used ? usageSummary(used) : '',
        ]
      }),
    ]))
      console.log(line)
  },
})

const search = defineCommand({
  meta: {
    name: 'search',
    description: "Find the messages that hold every word, in every Agent's conversations",
  },
  args: {
    query: positional('Words to find (quote several: "launch email")'),
    agent: { type: 'string', description: 'Only this Agent (id or name)' },
    limit: { type: 'string', default: '20', description: 'Most messages listed (up to 50)' },
    json: jsonFlag,
  },
  async run({ args }) {
    const query = new URLSearchParams({ q: args.query, limit: args.limit })
    if (args.agent) query.set('agent', args.agent)
    const body = await createClient().get<ConversationSearchResponse>(
      `/api/conversations/search?${query}`,
    )
    if (args.json) return printJson(body)
    if (body.hits.length === 0) console.log('(no messages hold every word)')
    for (const hit of body.hits) {
      const when = hit.at ? new Date(hit.at).toISOString().slice(0, 16).replace('T', ' ') : ''
      console.log(
        terminalSafe(
          `${hit.agentName} · ${hit.conversationTitle}${hit.active ? ' (active)' : ''} · ${hit.role === 'user' ? 'you' : hit.agentName} ${when}`,
        ),
      )
      console.log(`  ${terminalSafe(hit.snippet)}`)
      console.log(`  bazilion conversation show ${hit.agentId.slice(0, 8)} ${hit.conversationId}`)
    }
    if (body.truncated) console.log(`Only the newest ${body.hits.length}; use --limit for more.`)
    if (body.unreadable > 0)
      console.log(
        `${body.unreadable} conversation${body.unreadable === 1 ? '' : 's'} could not be read.`,
      )
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Read a conversation without making it active' },
  args: { agent: agentArg, id: conversationArg, json: jsonFlag },
  async run({ args }) {
    const body = await createClient().get<{
      conversation: Conversation
      messages: ProviderMessage[]
      usage: ConversationUsage | null
    }>(apiPath('agents', args.agent, 'conversations', args.id))
    if (args.json) return printJson(body)
    console.log(
      body.usage
        ? `${body.conversation.title} (${usageSummary(body.usage)})`
        : body.conversation.title,
    )
    for (const message of body.messages) console.log(`[${message.role}] ${message.content}`)
  },
})

const newConversation = defineCommand({
  meta: {
    name: 'new',
    description: 'Start a new conversation and make it active; earlier ones stay readable',
  },
  args: {
    agent: agentArg,
    title: { type: 'string', description: 'Title (default: generated)' },
    json: jsonFlag,
  },
  async run({ args }) {
    const conversation = await createClient().post<Conversation>(
      apiPath('agents', args.agent, 'conversations'),
      args.title ? { title: args.title } : {},
    )
    if (args.json) return printJson(conversation)
    console.log(`Conversation ${conversation.id}: ${conversation.title} (active)`)
  },
})

const rename = defineCommand({
  meta: { name: 'rename', description: 'Rename a conversation' },
  args: {
    agent: agentArg,
    id: conversationArg,
    title: positional('New title'),
    json: jsonFlag,
  },
  async run({ args }) {
    const body = await createClient().patch<{ conversation: Conversation }>(
      apiPath('agents', args.agent, 'conversations', args.id),
      { title: args.title },
    )
    if (args.json) return printJson(body)
    console.log(body.conversation.title)
  },
})

const select = defineCommand({
  meta: {
    name: 'select',
    description: 'Switch to an earlier conversation: new messages continue it',
  },
  args: { agent: agentArg, id: conversationArg, json: jsonFlag },
  async run({ args }) {
    const body = await createClient().post<{ conversation: Conversation }>(
      apiPath('agents', args.agent, 'conversations', args.id, 'select'),
    )
    if (args.json) return printJson(body)
    console.log(`Conversation ${body.conversation.id}: ${body.conversation.title} (active)`)
  },
})

export const conversationCommand = defineCommand({
  meta: {
    name: 'conversation',
    description: 'List, read, start, rename and switch Agent conversations',
  },
  subCommands: { list, show, new: newConversation, rename, select, search },
})
