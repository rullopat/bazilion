// /api/activity: what every Agent is doing and what waits for the operator, in one response.

import type { ActivityResponse } from '@bazilion/api-types'
import { readActivity } from '../lib/activity.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter } from './http.ts'

export const activityRouter = newRouter()

activityRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  return c.json({ agents: readActivity(db, paths) } satisfies ActivityResponse)
})
