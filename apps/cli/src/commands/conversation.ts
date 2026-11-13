import type { Conversation, ConversationListResponse, ProviderMessage } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { agentArg, apiPath, jsonFlag, positional, printJson } from '../command-helpers.ts'

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
      ['id', 'title', 'active'],
      ...body.conversations.map((item) => [
        item.id,
        item.title,
        item.id === body.selectedId ? 'yes' : '',
      ]),
    ]))
      console.log(line)
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Read a conversation without making it active' },
  args: { agent: agentArg, id: conversationArg, json: jsonFlag },
  async run({ args }) {
    const body = await createClient().get<{
      conversation: Conversation
      messages: ProviderMessage[]
    }>(apiPath('agents', args.agent, 'conversations', args.id))
    if (args.json) return printJson(body)
    console.log(body.conversation.title)
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

export const conversationCommand = defineCommand({
  meta: { name: 'conversation', description: 'List, read, start and rename Agent conversations' },
  subCommands: { list, show, new: newConversation, rename },
})
