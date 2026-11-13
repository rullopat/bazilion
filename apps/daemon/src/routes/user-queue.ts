import type { EnqueueUserInput, UserQueueListResponse } from '@bazilion/api-types'
import { bodyLimit } from 'hono/body-limit'
import * as queue from '../core/repos/user-queue.ts'
import { isActiveAgent } from '../lib/agent-cancel.ts'
import { getCtx } from '../lib/ctx.ts'
import { notifyTelegramQueueOutcome } from '../lib/telegram/queue-notice.ts'
import { enqueueUserInput } from '../lib/user-queue.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

// The follow-up queue of one Agent: list, add, edit, remove, pause and resume.

export const userQueueRouter = newRouter<{ Variables: { agentId: string } }>()
userQueueRouter.use('/:agentId/queue/*', bodyLimit({ maxSize: 36 * 1024 * 1024 }))
userQueueRouter.use('/:agentId/queue/*', async (c, next) => {
  // Accepts an Agent id, unique name or id prefix; everything below uses the full id.
  c.set('agentId', routeAgent(c, 'agentId').id)
  await next()
})

userQueueRouter.get('/:agentId/queue', (c) =>
  c.json({
    ...queue.list(getCtx().db, c.get('agentId')),
    turnActive: isActiveAgent(c.get('agentId')),
  } satisfies UserQueueListResponse),
)
userQueueRouter.post('/:agentId/queue', async (c) => {
  const input = await jsonBody<EnqueueUserInput>(c)
  return c.json(
    await enqueueUserInput(c.get('agentId'), {
      message: input?.message as string,
      attachments: input?.attachments ?? [],
    }),
    202,
  )
})
/** Replace a waiting follow-up's text. */
userQueueRouter.patch('/:agentId/queue/:id', async (c) => {
  const input = await jsonBody<Pick<EnqueueUserInput, 'message'>>(c)
  return c.json(
    queue.edit(getCtx().db, c.get('agentId'), c.req.param('id'), input?.message as string),
  )
})
userQueueRouter.delete('/:agentId/queue/:id', async (c) => {
  const { item, origin } = queue.remove(getCtx().db, c.get('agentId'), c.req.param('id'))
  if (item.status === 'pending') await notifyTelegramQueueOutcome(item, origin, 'removed')
  return c.json(item)
})
/** Pause or resume: a paused queue starts nothing; what is running keeps running. */
userQueueRouter.post('/:agentId/queue/control', async (c) => {
  const input = await jsonBody<{ paused: boolean }>(c)
  if (typeof input?.paused !== 'boolean') return c.json({ error: 'paused must be a boolean' }, 400)
  queue.setPaused(getCtx().db, c.get('agentId'), input.paused)
  return c.json({ paused: input.paused })
})
