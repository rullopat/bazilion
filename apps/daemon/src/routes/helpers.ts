// An Agent's helpers (BAZ-092): /api/agents/:id/helpers lists the running and the ones that ended
// since the daemon started; /api/agents/:id/helpers/:helperId/stop stops one.

import type { ListHelpersResponse, StopHelperResponse } from '@bazilion/api-types'
import { listHelpers, stopHelper } from '../lib/helpers.ts'
import { newRouter, routeAgent } from './http.ts'

export const agentHelpersRouter = newRouter()

agentHelpersRouter.get('/:id/helpers', (c) =>
  c.json({ helpers: listHelpers(routeAgent(c).id) } satisfies ListHelpersResponse),
)

agentHelpersRouter.post('/:id/helpers/:helperId/stop', async (c) =>
  c.json({
    helper: await stopHelper(routeAgent(c).id, c.req.param('helperId'), 'owner'),
  } satisfies StopHelperResponse),
)
