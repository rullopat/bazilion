import type { NewConversationInput } from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import * as conversations from '../core/repos/conversations.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { startConversation } from '../lib/conversation-target.ts'
import { getCtx } from '../lib/ctx.ts'
import { loadInitialMessages, piMessagesToProviderView } from '../runtime/index.ts'
import { envSecretValues } from '../runtime/worker/runtime.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

// The conversation library: list, start, read and rename an Agent's conversations.

export const conversationsRouter = newRouter<{ Variables: { agentId: string } }>()

conversationsRouter.use('/:agentId/conversations/*', async (c, next) => {
  // Accepts an Agent id, unique name or id prefix; everything below uses the full id.
  c.set('agentId', routeAgent(c, 'agentId').id)
  await next()
})

conversationsRouter.get('/:agentId/conversations', (c) =>
  c.json(
    conversations.list(
      getCtx().db,
      c.get('agentId'),
      Number(c.req.query('limit') ?? 20),
      Number(c.req.query('offset') ?? 0),
    ),
  ),
)

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
    const messages = piMessagesToProviderView(
      loadInitialMessages(resolveAgent(db, paths, agentId), paths, { id }),
      envSecretValues(mergeSecretsIntoEnv(db, authToken)),
    )
    return c.json({ conversation, messages })
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
