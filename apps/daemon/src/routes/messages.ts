// /api/messages/:id — fetch + mark-read for a single message. (Inbox listing
// + send is per-agent at /api/agents/:id/messages.)

import type { UpdateMessageRequest } from '@bazilion/api-types'
import { Hono } from 'hono'
import { messageRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

export const messagesRouter = new Hono()

messagesRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const msg = messageRepo.get(db, c.req.param('id'))
  if (!msg) return c.json({ error: `message not found: ${c.req.param('id')}` }, 404)
  return c.json(msg)
})

messagesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as UpdateMessageRequest | null
  if (!body || body.read !== true) {
    return c.json({ error: 'body must be {read: true}' }, 400)
  }
  const { db } = getCtx()
  const existing = messageRepo.get(db, id)
  if (!existing) return c.json({ error: `message not found: ${id}` }, 404)
  messageRepo.markRead(db, id)
  return c.json(messageRepo.get(db, id))
})
