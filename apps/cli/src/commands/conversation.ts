import { randomUUID } from 'node:crypto'
import type {
  Conversation,
  ConversationListResponse,
  ConversationSelection,
  ProviderMessage,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

const positional = { type: 'positional', required: true } as const
const pathFor = (agent: string) => `/api/agents/${encodeURIComponent(agent)}/conversations`
const list = defineCommand({
  meta: { name: 'list', description: 'List retained conversations and active selection' },
  args: {
    agent: positional,
    limit: { type: 'string', default: '20' },
    offset: { type: 'string', default: '0' },
    json: { type: 'boolean' },
  },
  async run({ args }) {
    const query = new URLSearchParams({ limit: args.limit, offset: args.offset })
    const body = await createClient().get<ConversationListResponse>(
      `${pathFor(args.agent)}?${query}`,
    )
    if (args.json) return console.log(JSON.stringify(body, null, 2))
    if (!body.total) return console.log('(no conversations)')
    for (const line of columnize([
      ['id', 'title', 'active'],
      ...body.conversations.map((item) => [
        item.id,
        item.title,
        item.id === body.selection.conversationId ? 'yes' : '',
      ]),
    ]))
      console.log(line)
    console.log(`Selection revision: ${body.selection.revision}`)
  },
})
const show = defineCommand({
  meta: { name: 'show', description: 'Read retained history without selecting it' },
  args: { agent: positional, id: positional, json: { type: 'boolean' } },
  async run({ args }) {
    const body = await createClient().get<{
      conversation: Conversation
      messages: ProviderMessage[]
      selection: ConversationSelection
    }>(`${pathFor(args.agent)}/${encodeURIComponent(args.id)}`)
    if (args.json) return console.log(JSON.stringify(body, null, 2))
    console.log(body.conversation.title)
    for (const message of body.messages) console.log(`[${message.role}] ${message.content}`)
  },
})
const newConversation = defineCommand({
  meta: {
    name: 'new',
    description: 'Start a new conversation, retaining existing history and files',
  },
  args: {
    agent: positional,
    title: { type: 'string' },
    'request-id': { type: 'string', description: 'UUID for reconciling a lost response' },
    'expected-revision': {
      type: 'string',
      description: 'Original selection revision for an exact retry',
    },
    'expected-conversation': {
      type: 'string',
      description: 'Original selected ID, or none for an empty selection',
    },
    json: { type: 'boolean' },
  },
  async run({ args }) {
    const client = createClient()
    const state = await client.get<ConversationListResponse>(`${pathFor(args.agent)}?limit=1`)
    const requestId = args['request-id'] ?? randomUUID()
    const revision =
      args['expected-revision'] === undefined
        ? state.selection.revision
        : Number(args['expected-revision'])
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new Error('Invalid expected revision')
    if (
      args['request-id'] &&
      (args['expected-revision'] === undefined || args['expected-conversation'] === undefined)
    ) {
      throw new Error(
        '--request-id requires --expected-revision and --expected-conversation for an exact retry',
      )
    }
    const expectedSelection = {
      revision,
      conversationId:
        args['expected-conversation'] === undefined
          ? state.selection.conversationId
          : args['expected-conversation'] === 'none'
            ? null
            : args['expected-conversation'],
    }
    console.error(
      `Create request: ${requestId}; retry with --request-id ${requestId} --expected-revision ${revision} --expected-conversation ${expectedSelection.conversationId ?? 'none'} and the same title.`,
    )
    const body = await client.post<{
      conversation: Conversation
      selection: ConversationSelection
    }>(pathFor(args.agent), {
      requestId,
      expectedSelection,
      ...(args.title ? { title: args.title } : {}),
    })
    console.log(
      args.json
        ? JSON.stringify(body, null, 2)
        : `Conversation ${body.conversation.id}: ${body.conversation.title} (active: ${body.selection.conversationId})`,
    )
  },
})
const rename = defineCommand({
  meta: {
    name: 'rename',
    description: 'Rename a conversation without changing its selection or history',
  },
  args: { agent: positional, id: positional, title: positional, json: { type: 'boolean' } },
  async run({ args }) {
    const client = createClient()
    const path = `${pathFor(args.agent)}/${encodeURIComponent(args.id)}`
    const current = await client.get<{ conversation: Conversation }>(path)
    const body = await client.patch<{ conversation: Conversation }>(path, {
      title: args.title,
      expectedTitleRevision: current.conversation.titleRevision,
    })
    console.log(args.json ? JSON.stringify(body, null, 2) : body.conversation.title)
  },
})
export const conversationCommand = defineCommand({
  meta: { name: 'conversation', description: 'List, read, create and rename Agent conversations' },
  subCommands: { list, show, new: newConversation, rename },
})
