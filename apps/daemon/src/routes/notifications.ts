import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import * as receipts from '../core/repos/notifications.ts'
import { getCtx } from '../lib/ctx.ts'
import { notificationsFor } from '../lib/notifications.ts'

export const notificationsRouter = new Hono()
notificationsRouter.use('*', bodyLimit({ maxSize: 32 * 1024 }))
notificationsRouter.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})
notificationsRouter.onError((error, c) => {
  if (error instanceof HTTPException && error.status === 413)
    return c.json({ error: 'Notification request exceeds 32 KiB' }, 413)
  const code = /^notification_[a-z_]+$/.test(error.message)
    ? error.message
    : 'notification_input_invalid'
  return c.json({ error: code, code }, code === 'notification_input_invalid' ? 400 : 409)
})
function service() {
  const { db, authToken } = getCtx()
  return notificationsFor(db, authToken)
}
notificationsRouter.get('/', async (c) => {
  const current = service()
  return c.json({ ...(await current.control.read()), diagnostic: current.dispatcher.diagnostic })
})
notificationsRouter.put('/', async (c) =>
  c.json(await service().control.configure(await c.req.json())),
)
notificationsRouter.post('/preview', async (c) => {
  const body = await c.req.json()
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'kinds')
  )
    return c.json({ error: 'Expected {kinds}' }, 400)
  return c.json(await service().control.preview(body.kinds))
})
notificationsRouter.get('/receipts', (c) => {
  const limit = Number(c.req.query('limit') ?? 50)
  const cursor = c.req.query('cursor')
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor && !/^[a-f0-9-]{36}$/.test(cursor))
  )
    return c.json({ error: 'Invalid notification receipt page' }, 400)
  return c.json(receipts.list(getCtx().db, { limit, cursor }))
})
notificationsRouter.get('/receipts/:id', (c) => {
  const receipt = receipts.get(getCtx().db, c.req.param('id'))
  return receipt ? c.json(receipt) : c.json({ error: 'Notification receipt not found' }, 404)
})
notificationsRouter.post('/receipts/:id/retry', async (c) => {
  const body = await c.req.json()
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['expectedUpdatedAt', 'acknowledgePossibleDuplicate'].includes(key),
    ) ||
    !Number.isSafeInteger(body.expectedUpdatedAt) ||
    body.expectedUpdatedAt < 0 ||
    typeof body.acknowledgePossibleDuplicate !== 'boolean'
  )
    return c.json(
      { error: 'Retry requires the observed receipt timestamp and duplicate acknowledgement' },
      400,
    )
  return c.json(
    await service().control.retry(
      c.req.param('id'),
      body.expectedUpdatedAt,
      body.acknowledgePossibleDuplicate,
    ),
  )
})
