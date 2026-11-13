// /api/agents/:id/browser: the agent's managed browser. Status never launches anything; stop and
// reset refuse while the agent has a turn running, since it may be using the browser. The CLI
// and the web UI ask the operator to confirm a reset before calling it.

import { mergeSecretsIntoEnv } from '../core/index.ts'
import { runAgentLifecycleMutation } from '../lib/agent-cancel.ts'
import { isBrowserEnabled, resolveBrowserConfig } from '../lib/browser/config.ts'
import { browserStatus, closeBrowserSession, removeBrowserProfile } from '../lib/browser/pool.ts'
import { getCtx } from '../lib/ctx.ts'
import { newRouter, routeAgent } from './http.ts'

export const agentBrowserRouter = newRouter()

agentBrowserRouter.get('/:id/browser', (c) => {
  const { db, paths, authToken } = getCtx()
  const { id } = routeAgent(c)
  const env = mergeSecretsIntoEnv(db, authToken)
  return c.json(browserStatus(id, resolveBrowserConfig(env), paths, isBrowserEnabled(env)))
})

agentBrowserRouter.post('/:id/browser/stop', async (c) => {
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => closeBrowserSession(id))
  return c.body(null, 204)
})

agentBrowserRouter.delete('/:id/browser/profile', async (c) => {
  const { id } = routeAgent(c)
  await runAgentLifecycleMutation(id, () => removeBrowserProfile(id, getCtx().paths))
  return c.body(null, 204)
})
