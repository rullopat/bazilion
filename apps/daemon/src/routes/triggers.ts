// Scheduled triggers: /api/agents/:id/triggers lists and creates an agent's triggers,
// /api/triggers/:id enables, disables, deletes one and shows its run history.

import type {
  CreateTriggerRequest,
  ListTriggerDispatchesResponse,
  ListTriggersResponse,
  UpdateTriggerRequest,
} from '@bazilion/api-types'
import { triggerDispatchRepo, triggerRepo } from '../core/index.ts'
import { validateCron } from '../lib/cron.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const triggersRouter = newRouter()

function triggerExists(id: string): boolean {
  return triggerRepo.get(getCtx().db, id) !== null
}

triggersRouter.get('/:id/dispatches', (c) => {
  const id = c.req.param('id')
  if (!triggerExists(id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  const requestedLimit = Number(c.req.query('limit') ?? 20)
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return c.json({ error: 'limit must be a positive integer' }, 400)
  }
  const limit = Math.min(100, requestedLimit)
  return c.json({
    dispatches: triggerDispatchRepo.listForTrigger(getCtx().db, id, limit),
  } satisfies ListTriggerDispatchesResponse)
})

triggersRouter.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!triggerExists(id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  triggerRepo.remove(getCtx().db, id)
  return c.body(null, 204)
})

triggersRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await jsonBody<UpdateTriggerRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  if (!triggerExists(id)) return c.json({ error: `trigger not found: ${id}` }, 404)
  const { db } = getCtx()
  if (typeof body.enabled === 'boolean') triggerRepo.setEnabled(db, id, body.enabled)
  return c.json({ trigger: triggerRepo.get(db, id) })
})

export const agentTriggersRouter = newRouter()

agentTriggersRouter.get('/:id/triggers', (c) => {
  const { db } = getCtx()
  const triggers = triggerRepo.listForAgent(db, routeAgent(c).id)
  return c.json({
    triggers,
    dispatches: triggers.flatMap((trigger) =>
      triggerDispatchRepo.listForTrigger(db, trigger.id, 10),
    ),
  } satisfies ListTriggersResponse)
})

agentTriggersRouter.post('/:id/triggers', async (c) => {
  const body = await jsonBody<CreateTriggerRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const agentId = routeAgent(c).id
  const { db } = getCtx()

  if (body.kind === 'interval') {
    const intervalSec = body.intervalSec
    if (typeof intervalSec !== 'number' || !Number.isInteger(intervalSec) || intervalSec < 1) {
      return c.json({ error: 'intervalSec must be a whole number of seconds, at least 1' }, 400)
    }
    const trigger = triggerRepo.insert(db, {
      agentId,
      kind: 'interval',
      intervalSec,
      cronExpr: null,
      message: body.message,
      enabled: body.enabled,
    })
    return c.json({ trigger }, 201)
  }

  if (body.kind === 'cron') {
    if (typeof body.cronExpr !== 'string' || !body.cronExpr.trim()) {
      return c.json({ error: 'cronExpr is required for kind=cron' }, 400)
    }
    try {
      validateCron(body.cronExpr)
    } catch (err) {
      return c.json({ error: `invalid cron: ${(err as Error).message}` }, 400)
    }
    const trigger = triggerRepo.insert(db, {
      agentId,
      kind: 'cron',
      intervalSec: null,
      cronExpr: body.cronExpr.trim(),
      message: body.message,
      enabled: body.enabled,
    })
    return c.json({ trigger }, 201)
  }

  return c.json({ error: `invalid kind: ${body.kind}` }, 400)
})
