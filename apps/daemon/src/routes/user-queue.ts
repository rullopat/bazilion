import type { EditQueuedInput, EnqueueUserInput } from '@bazilion/api-types'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { resolveAgent } from '../core/agent/resolve.ts'
import { ConversationConflictError } from '../core/repos/conversations.ts'
import * as queue from '../core/repos/user-queue.ts'
import { cancelAgent } from '../lib/agent-cancel.ts'
import { CommunicationDeniedError } from '../lib/communication.ts'
import { getCtx } from '../lib/ctx.ts'
import { notifyTelegramQueueStatus } from '../lib/telegram/queue-notice.ts'
import { enqueueHttpInput } from '../lib/user-queue-admission.ts'

export const userQueueRouter = new Hono()
userQueueRouter.use('/:agentId/queue/*', bodyLimit({ maxSize: 36 * 1024 * 1024 }))
userQueueRouter.use('/:agentId/queue/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  const { db, paths } = getCtx()
  try {
    resolveAgent(db, paths, c.req.param('agentId'))
  } catch {
    return c.json({ error: 'Agent not found' }, 404)
  }
  queue.reconcileApprovalHolds(db)
  await next()
})
userQueueRouter.onError((error, c) => {
  if (error instanceof queue.QueueConflictError)
    return c.json({ error: error.message, code: error.code }, 409)
  if (error instanceof queue.QueueCapacityError)
    return c.json({ error: error.message, code: error.code }, 429)
  if (error instanceof ConversationConflictError)
    return c.json({ error: error.message, code: error.code, selection: error.selection }, 409)
  if (error instanceof CommunicationDeniedError)
    return c.json({ error: 'Team Policy denied this input', code: 'communication_denied' }, 403)
  return c.json({ error: 'Invalid queue request' }, 400)
})
userQueueRouter.get('/:agentId/queue', (c) =>
  c.json(
    queue.list(getCtx().db, c.req.param('agentId'), {
      all: c.req.query('all') === '1',
      limit: Number(c.req.query('limit') ?? 20),
      offset: Number(c.req.query('offset') ?? 0),
    }),
  ),
)
userQueueRouter.post('/:agentId/queue', async (c) =>
  c.json(await enqueueHttpInput(c.req.param('agentId'), await c.req.json<EnqueueUserInput>()), 202),
)
userQueueRouter.get('/:agentId/queue/:id', (c) => {
  const item = queue.get(getCtx().db, c.req.param('agentId'), c.req.param('id'))
  return item ? c.json(item) : c.json({ error: 'Queue item not found' }, 404)
})
userQueueRouter.get('/:agentId/queue/:id/input', (c) => {
  const input = queue.readInput(getCtx().db, c.req.param('agentId'), c.req.param('id'))
  return c.json({ message: input.item.text, attachments: input.attachments })
})
userQueueRouter.patch('/:agentId/queue/:id', async (c) => {
  const input = await c.req.json<EditQueuedInput>()
  return c.json(
    await enqueueHttpInput(c.req.param('agentId'), input, {
      id: c.req.param('id'),
      expectedRevision: revision(input.expectedRevision),
    }),
  )
})
userQueueRouter.delete('/:agentId/queue/:id', async (c) => {
  const input = await c.req.json<{ expectedRevision: number }>()
  const item = queue.remove(
    getCtx().db,
    c.req.param('agentId'),
    c.req.param('id'),
    revision(input.expectedRevision),
  )
  await notifyTelegramQueueStatus(getCtx().db, item.agentId, item.id)
  return c.json(item)
})
userQueueRouter.post('/:agentId/queue/control', async (c) => {
  const input = await c.req.json<{ paused: boolean; expectedRevision: number }>()
  return c.json(
    queue.setPaused(
      getCtx().db,
      c.req.param('agentId'),
      input.paused,
      revision(input.expectedRevision),
      input.paused ? 'operator' : null,
    ),
  )
})
userQueueRouter.post('/:agentId/queue/stop', async (c) => {
  const input = await c.req.json<{ expectedRevision: number }>()
  const agentId = c.req.param('agentId')
  // Persist pause before cancellation: a failed/stale control write must not abort current work.
  const control = queue.setPaused(
    getCtx().db,
    agentId,
    true,
    revision(input.expectedRevision),
    'operator_stop',
  )
  return c.json({ control, cancelled: cancelAgent(agentId) })
})
userQueueRouter.post('/:agentId/queue/:id/reconcile', async (c) => {
  const input = await c.req.json<{ expectedRevision: number; acknowledged: boolean }>()
  if (input.acknowledged !== true)
    return c.json({ error: 'Acknowledge that this input may already have acted' }, 400)
  const { db } = getCtx()
  const agentId = c.req.param('agentId')
  const id = c.req.param('id')
  const item = db.raw.transaction(() => {
    const current = queue.get(db, agentId, id)
    if (
      !current ||
      current.revision !== revision(input.expectedRevision) ||
      current.status !== 'uncertain'
    )
      throw new queue.QueueConflictError('Queue item changed or is not uncertain')
    return queue.transition(db, agentId, id, 'uncertain', 'cancelled', {
      diagnostic: 'Operator acknowledged uncertain outcome; input will not be replayed',
    })
  })()
  return c.json(item)
})
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid queue revision')
  return value
}
