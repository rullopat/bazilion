import { Hono } from 'hono'
import { type AuthorizationInput, authorizeCommunication } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

export const communicationRouter = new Hono()

communicationRouter.post('/evaluate', async (c) => {
  const input = (await c.req.json().catch(() => null)) as AuthorizationInput | null
  if (
    !input ||
    !input.source ||
    !input.target ||
    typeof input.origin !== 'string' ||
    typeof input.attemptKind !== 'string' ||
    typeof input.attemptId !== 'string'
  ) {
    return c.json({ error: 'source, target, origin, attemptKind, and attemptId are required' }, 400)
  }
  return c.json(authorizeCommunication(getCtx().db, input))
})
