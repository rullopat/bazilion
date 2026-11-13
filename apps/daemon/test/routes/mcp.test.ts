import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mcpHttpFixture } from '../fixtures/mcp-http.ts'

let home: string
const saved: Record<string, string | undefined> = {}
const fixtures: Awaited<ReturnType<typeof mcpHttpFixture>>[] = []
beforeEach(() => {
  for (const key of ['BAZILION_HOME', 'BAZILION_SCHEDULER', 'BAZILION_TOKEN', 'COPIED_BOOTSTRAP'])
    saved[key] = process.env[key]
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
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
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
async function patch(id: string, body: unknown) {
  return (await router()).request(`/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
async function httpServer(name = 'fixture') {
  const f = await mcpHttpFixture()
  fixtures.push(f)
  const res = await post({ name, transport: 'http', url: f.url, authToken: 'PRIVATE_MCP_TOKEN' })
  expect(res.status).toBe(201)
  return { f, server: ((await res.json()) as { server: McpServer }).server }
}
async function turn() {
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { resolveMcpForTurn } = await import('../../src/lib/mcp/resolve.ts')
  const ctx = getCtx()
  return resolveMcpForTurn(ctx.db, ctx.authToken)
}

test('the bearer token is write-only, and /test connects afresh with it', async () => {
  const { f, server } = await httpServer()
  expect(server.hasAuthToken).toBe(true)
  expect(JSON.stringify(server)).not.toContain('PRIVATE_MCP_TOKEN')
  const r = await router()
  expect(await (await r.request('/')).text()).not.toContain('PRIVATE_MCP_TOKEN')
  expect(f.requests).toEqual([]) // Saving a server never connects to it.
  const tested = await r.request(`/${server.id}/test`, { method: 'POST' })
  expect(tested.status).toBe(200)
  expect(await tested.json()).toMatchObject({ ok: true, tools: [{ name: 'foo' }] })
  expect(f.requests[0]?.authorization).toBe('Bearer PRIVATE_MCP_TOKEN')
})

test('/test reports why a server cannot start', async () => {
  const created = await post({ name: 'missing', transport: 'stdio', command: '/nonexistent/mcp' })
  const { server } = (await created.json()) as { server: McpServer }
  const tested = await (await router()).request(`/${server.id}/test`, { method: 'POST' })
  expect(tested.status).toBe(502)
  expect(((await tested.json()) as { error: string }).error).toMatch(/failed to start: .*ENOENT/)
})

test('disabling or deleting a server stops a running turn from calling it', async () => {
  const { f, server } = await httpServer()
  const admitted = await turn()
  expect(admitted?.tools).toHaveLength(1)
  expect((await patch(server.id, { enabled: false })).status).toBe(200)
  await expect(admitted?.host.invoke(server.id, 'foo', {})).rejects.toThrow(/disabled or removed/)
  expect(await turn()).toBeNull()
  expect((await (await router()).request(`/${server.id}`, { method: 'DELETE' })).status).toBe(204)
  await expect(admitted?.host.invoke(server.id, 'foo', {})).rejects.toThrow(/disabled or removed/)
  expect(f.requests.filter((q) => q.method === 'tools/call')).toEqual([])
})

test('a rotated token reaches the server on the next connection', async () => {
  const { f, server } = await httpServer()
  await (await turn())?.host.invoke(server.id, 'foo', {})
  await patch(server.id, { authToken: 'NEW_MCP_TOKEN' })
  await (await turn())?.host.invoke(server.id, 'foo', {})
  expect(f.requests.filter((q) => q.method === 'tools/call').map((q) => q.authorization)).toEqual([
    'Bearer PRIVATE_MCP_TOKEN',
    'Bearer NEW_MCP_TOKEN',
  ])
})

test('a repeated tool name keeps the first server’s tool, not neither', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const first = await httpServer('a')
  await first.f.changeTools([{ name: 'bar__foo', inputSchema: { type: 'object' } }])
  const second = await httpServer('a__bar')
  const admitted = await turn()
  expect(admitted?.tools.map((tool) => [tool.toolName, tool.serverId])).toEqual([
    ['mcp__a__bar__foo', first.server.id],
  ])
  await expect(admitted?.host.invoke(second.server.id, 'foo', {})).rejects.toThrow(
    /not available in this turn/,
  )
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('repeats a name'))
})

test('a server that never answers delays a turn by the discovery deadline only', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  try {
    await post({
      name: 'silent',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const { f, server } = await httpServer()
    const { resources } = await import('../../src/lib/resources.ts')
    const pending = turn()
    // The answering server's tool list is in before the deadline passes.
    await vi.waitFor(() => {
      expect(f.requests.some((q) => q.method === 'tools/list')).toBe(true)
      expect(resources().mcp.get(server.id)?.tools).toHaveLength(1)
    })
    await vi.advanceTimersByTimeAsync(10_000)
    const admitted = await pending
    expect(admitted?.tools.map((tool) => tool.serverId)).toEqual([server.id])
    expect(warn).toHaveBeenCalledWith('mcp: server silent is unavailable: no answer within 10 s')
  } finally {
    vi.useRealTimers()
  }
})

test('a stdio server gets provider keys but never Bazilion’s own credentials', async () => {
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const { openSecrets } = await import('../../src/core/index.ts')
  const ctx = getCtx()
  const secrets = openSecrets(ctx.db, ctx.authToken)
  secrets.set('ANTHROPIC_API_KEY', 'provider-key')
  secrets.set('OPENAI_CODEX_OAUTH', '{"refresh":"r","access":"a","expires":1}')
  secrets.set('TELEGRAM_BOT_TOKEN', '123:bot')
  await httpServer() // stores an MCP_TOKEN_<id> secret
  process.env.BAZILION_TOKEN = 'cli-bearer'
  process.env.COPIED_BOOTSTRAP = ctx.authToken
  const created = await post({
    name: 'local',
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(new URL('../fixtures/mcp-stdio.mjs', import.meta.url))],
  })
  const { server } = (await created.json()) as { server: McpServer }
  const parts = await (await turn())?.host.invoke(server.id, 'foo', {})
  const { keys } = JSON.parse(parts?.[0]?.type === 'text' ? parts[0].text : '{}') as {
    keys: string[]
  }
  expect(keys).toContain('ANTHROPIC_API_KEY')
  for (const internal of [
    'OPENAI_CODEX_OAUTH',
    'TELEGRAM_BOT_TOKEN',
    'BAZILION_TOKEN',
    'COPIED_BOOTSTRAP',
  ])
    expect(keys).not.toContain(internal)
  expect(keys.filter((key) => key.startsWith('MCP_TOKEN_'))).toEqual([])
})

test.each([
  'file:///tmp/mcp',
  'https://user:password@example.invalid/mcp',
  'https://example.invalid/mcp#fragment',
])('refuses unsafe endpoint %s without connecting', async (url) => {
  expect((await post({ name: 'bad', transport: 'http', url })).status).toBe(400)
})

test('only stdio and http transports can be saved', async () => {
  const res = await post({ name: 'legacy', transport: 'sse', url: 'https://example.invalid/sse' })
  expect(res.status).toBe(400)
  expect(await res.text()).toContain('transport must be stdio or http')
})
