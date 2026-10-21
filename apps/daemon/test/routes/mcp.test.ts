import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mcpHttpFixture } from '../fixtures/mcp-http.ts'

let home: string
let oldHome: string | undefined
let oldScheduler: string | undefined
const fixtures: Awaited<ReturnType<typeof mcpHttpFixture>>[] = []
beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  oldScheduler = process.env.BAZILION_SCHEDULER
  home = mkdtempSync(join(tmpdir(), 'baz-mcp-route-'))
  process.env.BAZILION_HOME = home
  process.env.BAZILION_SCHEDULER = 'off'
  vi.resetModules()
})
afterEach(async () => {
  const { shutdownResources } = await import('../../src/lib/resources.ts')
  await shutdownResources()
  for (const f of fixtures.splice(0)) await f.close()
  const { getCtx } = await import('../../src/lib/ctx.ts')
  getCtx().db.close()
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  if (oldScheduler === undefined) delete process.env.BAZILION_SCHEDULER
  else process.env.BAZILION_SCHEDULER = oldScheduler
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})
async function router() {
  return (await import('../../src/routes/mcp.ts')).mcpRouter
}
async function post(body: unknown) {
  return (await router()).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function httpServer() {
  const f = await mcpHttpFixture()
  fixtures.push(f)
  const res = await post({
    name: 'fixture',
    transport: 'http',
    url: f.url,
    authToken: 'PRIVATE_SYNTHETIC_MCP_TOKEN',
  })
  expect(res.status).toBe(201)
  return {
    f,
    server: ((await res.json()) as { server: import('@bazilion/api-types').McpServer }).server,
  }
}
test('legacy SSE POST/PATCH is refused and the canonical schema excludes it', async () => {
  expect(
    (await post({ name: 'legacy', transport: 'sse', url: 'https://example.invalid/sse' })).status,
  ).toBe(400)
  const { server } = await httpServer()
  const patched = await (await router()).request(`/${server.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transport: 'sse' }),
  })
  expect(patched.status).toBe(400)
  expect(await patched.text()).toContain('legacy SSE is unsupported')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  expect(() =>
    getCtx().db.raw.run('UPDATE mcp_servers SET transport = ? WHERE id = ?', ['sse', server.id]),
  ).toThrow(/CHECK constraint/)
})
test('old SSE-capable schema requires clean rebootstrap, even without SSE rows', async () => {
  const { openInMemoryDb } = await import('../../src/core/db/client.ts')
  const { listMigrations, schemaMigrationsSql, assertMigrationCompatibility } = await import(
    '../../src/core/db/migrate.ts'
  )
  const old = openInMemoryDb()
  try {
    old.raw.exec(schemaMigrationsSql)
    for (const m of listMigrations()) {
      old.raw.exec(
        m.sql.replace("transport IN ('stdio','http')", "transport IN ('stdio','http','sse')"),
      )
      old.raw.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        m.version,
        Date.now(),
      ])
    }
    expect(() => assertMigrationCompatibility(old)).toThrow(/incompatible database schema/)
  } finally {
    old.close()
  }
})

test('ambiguous cross-server tool namespaces are denied, not silently substituted', async () => {
  const { f } = await httpServer()
  await f.changeTools([{ name: 'bar__foo', inputSchema: { type: 'object', properties: {} } }])
  const first = (await (await (await router()).request('/')).json()) as {
    servers: import('@bazilion/api-types').McpServer[]
  }
  await (await router()).request(`/${first.servers[0]!.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"a"}',
  })
  const other = await mcpHttpFixture()
  fixtures.push(other)
  await post({ name: 'a__bar', transport: 'http', url: other.url })
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resolveMcpForTurn } = await import('../../src/lib/mcp/resolve.ts')
  const ctx = getCtx()
  const admitted = await resolveMcpForTurn(ctx.db, {}, ctx.authToken)
  expect(admitted?.tools).toEqual([])
  await expect(admitted!.host.invoke(first.servers[0]!.id, 'bar__foo', {})).rejects.toThrow(
    /unknown MCP server/,
  )
  expect(f.requests.filter((q) => q.method === 'tools/call')).toEqual([])
  expect(other.requests.filter((q) => q.method === 'tools/call')).toEqual([])
})

test('management retains encrypted write-only tokens and explicit fresh Pi discovery', async () => {
  const { f, server } = await httpServer()
  expect(server.hasAuthToken).toBe(true)
  expect(JSON.stringify(server)).not.toContain('PRIVATE_SYNTHETIC_MCP_TOKEN')
  const r = await router()
  expect(await (await r.request('/')).text()).not.toContain('PRIVATE_SYNTHETIC_MCP_TOKEN')
  expect(f.requests).toEqual([]) // CRUD/readiness is never a passive connection probe.
  const tested = await r.request(`/${server.id}/test`, { method: 'POST' })
  expect(tested.status).toBe(200)
  expect(await tested.json()).toMatchObject({ ok: true, tools: [{ name: 'foo' }] })
  expect(f.requests[0]?.authorization).toBe('Bearer PRIVATE_SYNTHETIC_MCP_TOKEN')
})
test('disabled and deleted server capabilities cannot dispatch from an admitted turn', async () => {
  const { f, server } = await httpServer()
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resolveMcpForTurn } = await import('../../src/lib/mcp/resolve.ts')
  const ctx = getCtx()
  const admitted = await resolveMcpForTurn(ctx.db, {}, ctx.authToken)
  expect(admitted?.tools).toHaveLength(1)
  const r = await router()
  expect(
    (
      await r.request(`/${server.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{"enabled":false}',
      })
    ).status,
  ).toBe(200)
  await expect(admitted!.host.invoke(server.id, 'foo', {})).rejects.toThrow(/configuration changed/)
  expect(await resolveMcpForTurn(ctx.db, {}, ctx.authToken)).toBeNull()
  expect((await r.request(`/${server.id}`, { method: 'DELETE' })).status).toBe(204)
  await expect(admitted!.host.invoke(server.id, 'foo', {})).rejects.toThrow(/configuration changed/)
  expect(f.requests.filter((q) => q.method === 'tools/call')).toEqual([])
})
test('token rotation refuses the captured turn and reconnects only with new admission', async () => {
  const { f, server } = await httpServer()
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resolveMcpForTurn } = await import('../../src/lib/mcp/resolve.ts')
  const ctx = getCtx()
  const admitted = await resolveMcpForTurn(ctx.db, {}, ctx.authToken)
  const r = await router()
  await r.request(`/${server.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"authToken":"NEW_SYNTHETIC_TOKEN"}',
  })
  await expect(admitted!.host.invoke(server.id, 'foo', {})).rejects.toThrow(/configuration changed/)
  const fresh = await resolveMcpForTurn(ctx.db, {}, ctx.authToken)
  await fresh!.host.invoke(server.id, 'foo', {})
  expect(f.requests.filter((q) => q.method === 'tools/call')).toHaveLength(1)
  expect(f.requests.find((q) => q.method === 'tools/call')?.authorization).toBe(
    'Bearer NEW_SYNTHETIC_TOKEN',
  )
})
test.each([
  'file:///tmp/mcp',
  'https://user:password@example.invalid/mcp',
  'https://example.invalid/mcp#fragment',
])('refuses unsafe endpoint %s without connecting', async (url) => {
  expect((await post({ name: 'bad', transport: 'http', url })).status).toBe(400)
})
