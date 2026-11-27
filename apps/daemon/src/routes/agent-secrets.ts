// An Agent's secrets (BAZ-090): /api/agents/:id/secrets lists them without values, and
// /api/agents/:id/secrets/:name stores, replaces or removes one. Storing answers a secret
// request still waiting for that name.

import type {
  ListAgentSecretsResponse,
  SetAgentSecretRequest,
  SetAgentSecretResponse,
} from '@bazilion/api-types'
import { bodyLimit } from 'hono/body-limit'
import { listAgentSecrets } from '../core/agent-secrets.ts'
import { deleteAgentSecret, storeAgentSecret } from '../lib/agent-secrets.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

export const agentSecretsRouter = newRouter()
agentSecretsRouter.use('/:id/secrets/*', bodyLimit({ maxSize: 64 * 1024 }))

agentSecretsRouter.get('/:id/secrets', (c) => {
  const { db, authToken } = getCtx()
  return c.json({
    secrets: listAgentSecrets(db, authToken, routeAgent(c).id),
  } satisfies ListAgentSecretsResponse)
})

agentSecretsRouter.put('/:id/secrets/:name', async (c) => {
  const body = await jsonBody<SetAgentSecretRequest>(c)
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { db, authToken } = getCtx()
  const secret = storeAgentSecret(db, authToken, routeAgent(c).id, {
    name: c.req.param('name'),
    value: body.value,
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.hosts !== undefined ? { hosts: body.hosts } : {}),
  })
  return c.json({ secret } satisfies SetAgentSecretResponse)
})

agentSecretsRouter.delete('/:id/secrets/:name', (c) => {
  const { db, authToken } = getCtx()
  deleteAgentSecret(db, authToken, routeAgent(c).id, c.req.param('name'))
  return c.body(null, 204)
})
