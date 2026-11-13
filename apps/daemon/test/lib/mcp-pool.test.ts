import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import {
  callMcpTool,
  closeMcpConnection,
  getMcpConnection,
  listMcpTools,
  type McpServerConfig,
} from '../../src/lib/mcp/pool.ts'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'
import { fixtureTool, mcpHttpFixture } from '../fixtures/mcp-http.ts'

const fixtures: Awaited<ReturnType<typeof mcpHttpFixture>>[] = []
const dirs: string[] = []
const bearer = () => ({ authToken: 'SYNTHETIC_BEARER' })
afterEach(async () => {
  await shutdownResources()
  for (const f of fixtures.splice(0)) await f.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.restoreAllMocks()
})
async function setup() {
  const f = await mcpHttpFixture()
  fixtures.push(f)
  const server: McpServerConfig = {
    id: f.url,
    name: 'fixture',
    transport: 'http',
    command: null,
    args: [],
    url: f.url,
  }
  return { f, server }
}
const count = (f: Awaited<ReturnType<typeof mcpHttpFixture>>, method: string) =>
  f.requests.filter((r) => r.method === method).length

test('one HTTP connection is shared by concurrent first uses; tools are listed across pages', async () => {
  const { f, server } = await setup()
  await f.changeTools([fixtureTool, { ...fixtureTool, name: 'bar' }])
  const [a, b] = await Promise.all([
    getMcpConnection(server, bearer),
    getMcpConnection(server, bearer),
  ])
  expect(a).toBe(b)
  expect((await listMcpTools(server, bearer)).map((tool) => tool.toolName)).toEqual([
    'mcp__fixture__foo',
    'mcp__fixture__bar',
  ])
  expect(count(f, 'tools/list')).toBe(2)
  expect(await callMcpTool(server, 'foo', { q: 'fixture' }, { connect: bearer })).toEqual([
    { type: 'text', text: 'hello' },
  ])
  expect(count(f, 'initialize')).toBe(1)
  expect(f.requests.every((r) => r.authorization === 'Bearer SYNTHETIC_BEARER')).toBe(true)
  expect(f.requests.find((r) => r.method === 'tools/call')?.session).toBe('fixture-session')
})

test('a tool error reaches the caller with its text and the connection stays open', async () => {
  const { f, server } = await setup()
  f.setResponse({ isError: true, content: [{ type: 'text', text: 'element not found' }] })
  await expect(callMcpTool(server, 'foo', {}, { connect: bearer })).rejects.toThrow(
    'element not found',
  )
  f.setResponse({ content: [{ type: 'text', text: 'hello' }] })
  expect(await callMcpTool(server, 'foo', {}, { connect: bearer })).toEqual([
    { type: 'text', text: 'hello' },
  ])
  expect(count(f, 'initialize')).toBe(1)
  expect(count(f, 'tools/call')).toBe(2)
})

test.each([
  401, 429, 500,
])('HTTP %i fails the call once, without a retry or OAuth', async (status) => {
  const { f, server } = await setup()
  f.setStatus(status)
  await expect(callMcpTool(server, 'foo', {}, { connect: bearer })).rejects.toThrow()
  expect(count(f, 'tools/call')).toBe(1)
  expect(count(f, 'initialize')).toBe(1)
})

test('a redirect is refused, not followed with the bearer token', async () => {
  const { f, server } = await setup()
  const target = await setup()
  f.setRedirect(target.f.url)
  await expect(callMcpTool(server, 'foo', {}, { connect: bearer })).rejects.toThrow()
  expect(count(f, 'tools/call')).toBe(1)
  expect(target.f.requests).toEqual([])
})

test('tools are listed again after the server reports a change', async () => {
  const { f, server } = await setup()
  expect(await listMcpTools(server, bearer)).toHaveLength(1)
  await vi.waitFor(() => expect(f.streamCount).toBe(1))
  await f.changeTools([{ ...fixtureTool, description: 'changed contract' }])
  await vi.waitFor(async () =>
    expect((await listMcpTools(server, bearer))[0]?.description).toBe('changed contract'),
  )
  expect(count(f, 'initialize')).toBe(1)
})

test('a tool name a model API would reject is skipped with a warning', async () => {
  const { f, server } = await setup()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await f.changeTools([fixtureTool, { ...fixtureTool, name: 'bad.name' }])
  expect((await listMcpTools(server, bearer)).map((tool) => tool.rawName)).toEqual(['foo'])
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"bad.name"'))
})

test('closing during initialization publishes no connection; the next use reconnects', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  const opening = getMcpConnection(server, bearer)
  const rejected = expect(opening).rejects.toThrow()
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  await closeMcpConnection(server.id)
  f.release()
  await rejected
  expect(resources().mcp.has(server.id)).toBe(false)
  await listMcpTools(server, bearer)
  expect(count(f, 'initialize')).toBe(2)
})

test('shutdown closes connections that are still opening', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  const rejected = expect(getMcpConnection(server, bearer)).rejects.toThrow()
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  await shutdownResources()
  f.release()
  await rejected
  expect(resources().mcp.size).toBe(0)
})

test('a caller that aborts stops waiting for a server still starting; the connect goes on', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  const controller = new AbortController()
  const rejected = expect(listMcpTools(server, bearer, controller.signal)).rejects.toThrow(
    'MCP request aborted',
  )
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  controller.abort()
  await rejected
  f.release()
  expect(await listMcpTools(server, bearer)).toHaveLength(1)
  expect(count(f, 'initialize')).toBe(1)
})

test('a session the HTTP server lost fails that call once; the next call reconnects', async () => {
  const { f, server } = await setup()
  await callMcpTool(server, 'foo', {}, { connect: bearer })
  f.restart()
  await expect(callMcpTool(server, 'foo', {}, { connect: bearer })).rejects.toThrow(
    'MCP session expired',
  )
  expect(resources().mcp.has(server.id)).toBe(false)
  expect(await callMcpTool(server, 'foo', {}, { connect: bearer })).toEqual([
    { type: 'text', text: 'hello' },
  ])
  expect(count(f, 'initialize')).toBe(2)
  // The failed call was not replayed.
  expect(count(f, 'tools/call')).toBe(3)
})

test('a session lost while idle is noticed by the server-to-client stream', async () => {
  const { f, server } = await setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await listMcpTools(server, bearer)
  await vi.waitFor(() => expect(f.streamCount).toBe(1))
  f.restart()
  await vi.waitFor(() => expect(resources().mcp.has(server.id)).toBe(false), { timeout: 4000 })
  expect(await listMcpTools(server, bearer)).toHaveLength(1)
  expect(count(f, 'initialize')).toBe(2)
})

test('cancelling a call rejects it and keeps the connection', async () => {
  const { f, server } = await setup()
  await listMcpTools(server, bearer)
  const controller = new AbortController()
  f.delay('tools/call')
  const call = callMcpTool(server, 'foo', {}, { connect: bearer, signal: controller.signal })
  const rejected = expect(call).rejects.toThrow()
  await vi.waitFor(() => expect(count(f, 'tools/call')).toBe(1))
  controller.abort()
  await rejected
  f.release()
  expect(resources().mcp.has(server.id)).toBe(true)
})

test('the idle reaper never closes a busy connection, and closes it once idle', async () => {
  const { f, server } = await setup()
  const conn = await getMcpConnection(server, bearer)
  f.delay('tools/call')
  const call = callMcpTool(server, 'foo', {}, { connect: bearer })
  await vi.waitFor(() => expect(conn.busy).toBe(1))
  reapIdleResources(Date.now() + 60 * 60_000)
  expect(resources().mcp.get(server.id)).toBe(conn)
  f.release()
  await call
  reapIdleResources(Date.now() + 60 * 60_000)
  await vi.waitFor(() => expect(resources().mcp.has(server.id)).toBe(false))
})

function stdioServer(id: string, args: string[] = []): McpServerConfig {
  return {
    id,
    name: id,
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(new URL('../fixtures/mcp-stdio.mjs', import.meta.url)), ...args],
    url: null,
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    // A reparented zombie has stopped executing; the test cannot reap init's child.
    return !/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))
  } catch {
    return false
  }
}

test('a stdio server gets only the supplied environment; closing is graceful, then ends its whole process group', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baz-mcp-stdio-'))
  dirs.push(dir)
  const pidFile = join(dir, 'descendant.pid')
  const server = stdioServer('stdio_group', [pidFile])
  const old = process.env.MCP_FIXTURE_AMBIENT
  process.env.MCP_FIXTURE_AMBIENT = 'must-not-be-inherited'
  try {
    const parts = await callMcpTool(
      server,
      'foo',
      {},
      {
        connect: () => ({ env: { MCP_FIXTURE_SECRET: 'supplied' } }),
      },
    )
    const result = JSON.parse(parts[0]?.type === 'text' ? parts[0].text : '{}')
    expect(result.provided).toBe('supplied')
    expect(result.ambient).toBeNull()
    const descendant = Number(readFileSync(pidFile, 'utf8'))
    await closeMcpConnection(server.id)
    // Closing is graceful first: the server saw stdin end before the group was killed.
    expect(existsSync(`${pidFile}.stdin-closed`)).toBe(true)
    await vi.waitFor(
      () => {
        expect(alive(result.pid)).toBe(false)
        expect(alive(descendant)).toBe(false)
      },
      { timeout: 4000 },
    )
  } finally {
    if (old === undefined) delete process.env.MCP_FIXTURE_AMBIENT
    else process.env.MCP_FIXTURE_AMBIENT = old
  }
})

test('a stdio server that dies takes the rest of its process group with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'baz-mcp-stdio-'))
  dirs.push(dir)
  const pidFile = join(dir, 'descendant.pid')
  const server = stdioServer('stdio_died', [pidFile])
  const parts = await callMcpTool(server, 'foo', {}, { connect: () => ({ env: {} }) })
  const leader = JSON.parse(parts[0]?.type === 'text' ? parts[0].text : '{}').pid as number
  // This descendant ignores SIGTERM and holds none of the server's pipes.
  const descendant = Number(readFileSync(pidFile, 'utf8'))
  try {
    process.kill(leader, 'SIGKILL')
    await vi.waitFor(() => expect(alive(descendant)).toBe(false), { timeout: 4000 })
    expect(resources().mcp.has(server.id)).toBe(false)
  } finally {
    if (alive(descendant)) process.kill(descendant, 'SIGKILL')
  }
})

test('a stdio server that exits is started again on next use', async () => {
  const server = stdioServer('stdio_crash')
  const connect = () => ({ env: {} })
  const pid = (parts: Awaited<ReturnType<typeof callMcpTool>>) =>
    JSON.parse(parts[0]?.type === 'text' ? parts[0].text : '{}').pid as number
  const first = pid(await callMcpTool(server, 'foo', {}, { connect }))
  process.kill(first, 'SIGKILL')
  await vi.waitFor(() => expect(resources().mcp.has(server.id)).toBe(false))
  const second = pid(await callMcpTool(server, 'foo', {}, { connect }))
  expect(second).not.toBe(first)
})

test('a stdio server that cannot start reports why', async () => {
  const server: McpServerConfig = { ...stdioServer('stdio_missing'), command: '/nonexistent/mcp' }
  await expect(listMcpTools(server, () => ({ env: {} }))).rejects.toThrow(
    /MCP server stdio_missing failed to start: .*ENOENT/,
  )
  expect(resources().mcp.has(server.id)).toBe(false)
})
