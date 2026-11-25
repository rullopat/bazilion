import type {
  ConversationListResponse,
  ConversationSearchResponse,
  ConversationUsage,
  NewConversationInput,
} from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import * as conversations from '../core/repos/conversations.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { searchConversations } from '../lib/conversation-search.ts'
import { selectConversation, startConversation } from '../lib/conversation-target.ts'
import { getCtx } from '../lib/ctx.ts'
import { conversationUsage, planProviders } from '../lib/usage.ts'
import { loadConversation, piMessagesToProviderView } from '../runtime/index.ts'
import { envSecretValues } from '../runtime/worker/runtime.ts'
import { jsonBody, newRouter, routeAgent, routeAgentRef } from './http.ts'

// The conversation library: list, start, read, rename and switch an Agent's conversations.

export const conversationsRouter = newRouter<{ Variables: { agentId: string } }>()

/** `GET /api/conversations/search?q=…[&agent=…][&limit=…]`: messages holding every word. */
export const conversationSearchRouter = newRouter()

conversationSearchRouter.get('/search', async (c) => {
  const { db, paths, authToken } = getCtx()
  const agent = c.req.query('agent')
  return c.json(
    (await searchConversations(db, paths, {
      signal: c.req.raw.signal,
      query: c.req.query('q') ?? '',
      ...(agent ? { agentId: routeAgentRef(agent).id } : {}),
      limit: Number(c.req.query('limit') ?? 20) || 20,
      secrets: envSecretValues(mergeSecretsIntoEnv(db, authToken)),
    })) satisfies ConversationSearchResponse,
  )
})

conversationsRouter.use('/:agentId/conversations/*', async (c, next) => {
  // Accepts an Agent id, unique name or id prefix; everything below uses the full id.
  c.set('agentId', routeAgent(c, 'agentId').id)
  await next()
})

conversationsRouter.get('/:agentId/conversations', (c) => {
  const { db, paths } = getCtx()
  const list = conversations.list(
    db,
    c.get('agentId'),
    Number(c.req.query('limit') ?? 20),
    Number(c.req.query('offset') ?? 0),
  )
  const used = conversationUsage(
    paths,
    c.get('agentId'),
    planProviders(mergeSecretsIntoEnv(db, getCtx().authToken)),
  )
  const usage: Record<string, ConversationUsage> = {}
  for (const conversation of list.conversations) {
    const found = used.get(conversation.id)
    if (found) usage[conversation.id] = found
  }
  return c.json({ ...list, usage } satisfies ConversationListResponse)
})

/** Start a new conversation and make it the one new turns write to. */
conversationsRouter.post('/:agentId/conversations', async (c) => {
  const input = await jsonBody<NewConversationInput>(c)
  const agentId = c.get('agentId')
  const { db, paths } = getCtx()
  return c.json(
    await runAgentLifecycleMutation(agentId, () =>
      startConversation(db, paths, agentId, input?.title),
    ),
  )
})

conversationsRouter.get('/:agentId/conversations/:id', (c) => {
  const { db, paths, authToken } = getCtx()
  const agentId = c.get('agentId')
  const id = c.req.param('id')
  const conversation = conversations.get(db, agentId, id)
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404)
  try {
    const history = loadConversation(resolveAgent(db, paths, agentId), paths, { id })
    const messages = piMessagesToProviderView(
      history.messages,
      envSecretValues(mergeSecretsIntoEnv(db, authToken)),
    )
    const usage =
      conversationUsage(paths, agentId, planProviders(mergeSecretsIntoEnv(db, authToken))).get(
        id,
      ) ?? null
    return c.json({ conversation, messages, compactions: history.compactions, usage })
  } catch {
    return c.json(
      {
        error: 'Conversation history is missing, corrupt or unavailable',
        conversation,
      },
      409,
    )
  }
})

/** Switch to an earlier conversation: new turns write to it. Refused while a turn runs. */
conversationsRouter.post('/:agentId/conversations/:id/select', async (c) => {
  const agentId = c.get('agentId')
  const id = c.req.param('id')
  const { db, paths } = getCtx()
  return c.json({
    conversation: await runAgentLifecycleMutation(agentId, () =>
      selectConversation(db, paths, agentId, id),
    ),
  })
})

conversationsRouter.patch('/:agentId/conversations/:id', async (c) => {
  const input = await jsonBody<{ title: string }>(c)
  return c.json({
    conversation: conversations.rename(
      getCtx().db,
      c.get('agentId'),
      c.req.param('id'),
      input?.title as string,
    ),
  })
})
