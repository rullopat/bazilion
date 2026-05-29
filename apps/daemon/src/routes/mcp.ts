// /api/mcp-servers — CRUD + connection test for MCP servers.
//
// Servers are configured globally (v0.4.0): every enabled server's tools are
// injected into every agent turn, namespaced `mcp__<name>__<tool>`. The bearer
// token for http/sse transports is write-only — it's stored in the encrypted
// secrets table under `MCP_TOKEN_<id>` and never returned. Any mutation closes
// the live pooled connection so the next turn reconnects with fresh config.

import type { McpServerInput, McpToolInfo, McpTransport } from '@bazilion/api-types'
import { Hono } from 'hono'
import { mcpServerRepo, mergeSecretsIntoEnv, openSecrets } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { closeMcpConnection, discoverMcpTools, type McpServerConfig } from '../lib/mcp/pool.ts'
import { mcpTokenSecretKey } from '../lib/mcp/resolve.ts'

export const mcpRouter = new Hono()

const TRANSPORTS = new Set<McpTransport>(['stdio', 'http', 'sse'])

function validate(input: McpServerInput): string | null {
  // Restrict to [a-zA-Z0-9_] so the name IS its tool namespace. Allowing `-`
  // would let `foo-bar` and `foo_bar` both sanitize to `foo_bar`, colliding
  // their `mcp__foo_bar__*` tool names.
  if (!input.name || !/^[a-zA-Z0-9_]+$/.test(input.name)) {
    return 'name is required and must match [a-zA-Z0-9_]+ (letters, digits, underscore)'
  }
  if (!TRANSPORTS.has(input.transport)) return 'transport must be stdio, http, or sse'
  if (input.transport === 'stdio') {
    if (!input.command) return 'stdio transport requires a command'
  } else if (!input.url) {
    return `${input.transport} transport requires a url`
  }
  return null
}

function toConfig(s: {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
}): McpServerConfig {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: s.args,
    url: s.url,
  }
}

mcpRouter.get('/', (c) => {
  const { db } = getCtx()
  return c.json({ servers: mcpServerRepo.list(db) })
})

mcpRouter.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as McpServerInput | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const err = validate(body)
  if (err) return c.json({ error: err }, 400)
  const { db, authToken } = getCtx()
  if (mcpServerRepo.getByName(db, body.name)) {
    return c.json({ error: `an MCP server named "${body.name}" already exists` }, 409)
  }
  const hasAuth = typeof body.authToken === 'string' && body.authToken.length > 0
  const server = mcpServerRepo.insert(db, {
    name: body.name,
    transport: body.transport,
    command: body.command ?? null,
    args: body.args ?? [],
    url: body.url ?? null,
    hasAuth,
    enabled: body.enabled,
  })
  if (hasAuth) {
    openSecrets(db, authToken).set(mcpTokenSecretKey(server.id), body.authToken as string)
  }
  return c.json({ server }, 201)
})

mcpRouter.get('/:id', (c) => {
  const { db } = getCtx()
  const server = mcpServerRepo.get(db, c.req.param('id'))
  if (!server) return c.json({ error: 'MCP server not found' }, 404)
  return c.json({ server })
})

mcpRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Partial<McpServerInput> | null
  if (!body) return c.json({ error: 'invalid JSON body' }, 400)
  const { db, authToken } = getCtx()
  const existing = mcpServerRepo.get(db, id)
  if (!existing) return c.json({ error: 'MCP server not found' }, 404)

  // Name/transport changes still need to satisfy the same invariants.
  const merged: McpServerInput = {
    name: body.name ?? existing.name,
    transport: body.transport ?? existing.transport,
    command: body.command !== undefined ? body.command : existing.command,
    args: body.args ?? existing.args,
    url: body.url !== undefined ? body.url : existing.url,
  }
  const err = validate(merged)
  if (err) return c.json({ error: err }, 400)
  if (merged.name !== existing.name && mcpServerRepo.getByName(db, merged.name)) {
    return c.json({ error: `an MCP server named "${merged.name}" already exists` }, 409)
  }

  const secrets = openSecrets(db, authToken)
  let hasAuth: boolean | undefined
  if (body.authToken === null) {
    secrets.remove(mcpTokenSecretKey(id))
    hasAuth = false
  } else if (typeof body.authToken === 'string' && body.authToken.length > 0) {
    secrets.set(mcpTokenSecretKey(id), body.authToken)
    hasAuth = true
  }

  const server = mcpServerRepo.update(db, id, {
    name: merged.name,
    transport: merged.transport,
    command: merged.command,
    args: merged.args,
    url: merged.url,
    enabled: body.enabled,
    hasAuth,
  })
  // Config changed — drop the cached connection so the next turn reconnects.
  await closeMcpConnection(id)
  return c.json({ server })
})

mcpRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const { db, authToken } = getCtx()
  if (!mcpServerRepo.get(db, id)) return c.json({ error: 'MCP server not found' }, 404)
  await closeMcpConnection(id)
  openSecrets(db, authToken).remove(mcpTokenSecretKey(id))
  mcpServerRepo.remove(db, id)
  return c.body(null, 204)
})

mcpRouter.post('/:id/test', async (c) => {
  const id = c.req.param('id')
  const { db, authToken } = getCtx()
  const server = mcpServerRepo.get(db, id)
  if (!server) return c.json({ error: 'MCP server not found' }, 404)
  const env = mergeSecretsIntoEnv(db, authToken)
  const token =
    server.transport === 'stdio' ? undefined : openSecrets(db, authToken).get(mcpTokenSecretKey(id))
  // Force a fresh connection so the test reflects current config.
  await closeMcpConnection(id)
  try {
    const tools = await discoverMcpTools(toConfig(server), {
      env,
      authToken: token,
      idleMs: 900_000,
    })
    const info: McpToolInfo[] = tools.map((t) => ({ name: t.rawName, description: t.description }))
    return c.json({ ok: true, tools: info })
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
  }
})
