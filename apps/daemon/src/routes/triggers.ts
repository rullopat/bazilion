// /api/triggers/:id — enable/disable + delete. (Listing is per-agent at
// /api/agents/:id/triggers; creation is also per-agent.)

import type { UpdateTriggerRequest } from '@bazilion/api-types'
import { Hono } from 'hono'
import { triggerDispatchRepo, triggerRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

export const triggersRouter = new Hono()

triggersRouter.get('/:id/dispatches', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!triggerRepo.get(db, id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  const requestedLimit = Number(c.req.query('limit') ?? 20)
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return c.json({ error: 'limit must be a positive integer' }, 400)
  }
  const limit = Math.min(100, requestedLimit)
  return c.json({ dispatches: triggerDispatchRepo.listForTrigger(db, id, limit) })
})

triggersRouter.delete('/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  if (!triggerRepo.get(db, id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  triggerRepo.remove(db, id)
  return c.body(null, 204)
})

triggersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as UpdateTriggerRequest | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { db } = getCtx()
  if (!triggerRepo.get(db, id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  if (typeof body.enabled === 'boolean') {
    triggerRepo.setEnabled(db, id, body.enabled)
  }
  return c.json({ trigger: triggerRepo.get(db, id) })
})
