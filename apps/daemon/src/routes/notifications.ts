import { bodyLimit } from 'hono/body-limit'
import { getCtx } from '../lib/ctx.ts'
import { readNotificationSettings, saveNotificationSettings } from '../lib/notifications.ts'
import { newRouter } from './http.ts'

export const notificationsRouter = newRouter()
notificationsRouter.use('*', bodyLimit({ maxSize: 32 * 1024 }))

notificationsRouter.get('/', (c) => c.json(readNotificationSettings(getCtx().db)))

notificationsRouter.put('/', async (c) => {
  try {
    return c.json(saveNotificationSettings(getCtx().db, await c.req.json()))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid settings' }, 400)
  }
})
