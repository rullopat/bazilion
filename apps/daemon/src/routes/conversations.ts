import type { NewConversationInput } from '@bazilion/api-types'
import { buildSessionContext } from '@earendil-works/pi-coding-agent'
import { Hono } from 'hono'
import { resolveAgent } from '../core/agent/resolve.ts'
import * as conversations from '../core/repos/conversations.ts'
import { pendingCount } from '../core/repos/user-queue.ts'
import { runAgentLifecycleMutation } from '../lib/agent-lifecycle-lease.ts'
import { createConversationFile } from '../lib/conversation-file.ts'
import { getCtx } from '../lib/ctx.ts'
import { questionHistoryVisibility } from '../lib/question-history.ts'
import { readResultSession } from '../lib/result-source.ts'
import { piMessagesToProviderView } from '../runtime/pi/events.ts'

export const conversationsRouter = new Hono()

conversationsRouter.use('/:agentId/conversations/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  try {
    resolveAgent(getCtx().db, getCtx().paths, c.req.param('agentId'))
  } catch {
    return c.json({ error: 'Agent not found' }, 404)
  }
  await next()
})

conversationsRouter.onError((error, c) => {
  if (error instanceof conversations.ConversationConflictError)
    return c.json({ error: error.message, code: error.code, selection: error.selection }, 409)
  if (error instanceof conversations.ConversationRequestConflictError)
    return c.json({ error: error.message, code: error.code }, 409)
  const message = error.message
  if (
    message.startsWith('agent_turn_active:') ||
    message === 'Pending follow-ups must be resolved first'
  )
    return c.json({ error: message, code: 'agent_busy' }, 409)
  return c.json({ error: message }, 400)
})

conversationsRouter.get('/:agentId/conversations', (c) => {
  return c.json(
    conversations.list(
      getCtx().db,
      c.req.param('agentId'),
      Number(c.req.query('limit') ?? 20),
      Number(c.req.query('offset') ?? 0),
    ),
  )
})

conversationsRouter.post('/:agentId/conversations', async (c) => {
  const input = await c.req.json<NewConversationInput>()
  const agentId = c.req.param('agentId')
  const { db, paths } = getCtx()
  if (!input || typeof input.requestId !== 'string')
    return c.json({ error: 'Invalid conversation request' }, 400)
  // Reconciliation is a read: an already accepted request can be recovered while busy.
  if (conversations.get(db, agentId, input.requestId)) {
    return c.json(
      conversations.create(db, agentId, input, () => {
        throw new Error('Existing conversation disappeared')
      }),
    )
  }
  return c.json(
    await runAgentLifecycleMutation(agentId, () => {
      if (pendingCount(db, agentId) > 0)
        throw new Error('Pending follow-ups must be resolved first')
      const agent = resolveAgent(db, paths, agentId)
      return conversations.create(db, agentId, input, (id) =>
        createConversationFile(paths, agentId, id, agent.team.path),
      )
    }),
  )
})

conversationsRouter.get('/:agentId/conversations/:id', (c) => {
  const { db, paths } = getCtx()
  const agentId = c.req.param('agentId')
  const id = c.req.param('id')
  const conversation = conversations.get(db, agentId, id)
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404)
  try {
    const entries = readResultSession(paths, agentId, conversations.filename(db, agentId, id), id)
    const messages = piMessagesToProviderView(
      buildSessionContext(entries.filter((entry) => entry.type !== 'session')).messages,
      questionHistoryVisibility(db, agentId, id),
    )
    return c.json({ conversation, selection: conversations.selection(db, agentId), messages })
  } catch {
    return c.json(
      {
        error: 'Conversation history is missing, corrupt or unavailable',
        code: 'conversation_unavailable',
        conversation,
      },
      409,
    )
  }
})

conversationsRouter.patch('/:agentId/conversations/:id', async (c) => {
  const input = await c.req.json<{ title: string; expectedTitleRevision: number }>()
  if (!Number.isSafeInteger(input.expectedTitleRevision) || input.expectedTitleRevision < 1)
    return c.json({ error: 'Invalid title revision' }, 400)
  return c.json({
    conversation: conversations.rename(
      getCtx().db,
      c.req.param('agentId'),
      c.req.param('id'),
      input.title,
      input.expectedTitleRevision,
    ),
  })
})
