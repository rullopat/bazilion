import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioTransport } from '@earendil-works/pi-mcp'
import { afterEach, expect, test, vi } from 'vitest'
import { createMcpHost } from '../../src/lib/mcp/host.ts'
import {
  callMcpTool,
  closeMcpConnection,
  discoverMcpTools,
  getOrCreateMcpConnection,
  type McpServerConfig,
} from '../../src/lib/mcp/pool.ts'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'
import { fixtureTool, mcpHttpFixture } from '../fixtures/mcp-http.ts'

const fixtures: Awaited<ReturnType<typeof mcpHttpFixture>>[] = []
const dirs: string[] = []
const opts = { env: {}, idleMs: 1000, authToken: 'SYNTHETIC_BEARER' }
afterEach(async () => {
  await shutdownResources()
  for (const f of fixtures.splice(0)) await f.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

test('Pi HTTP connection is shared across concurrent admissions and paginated catalogs', async () => {
  const { f, server } = await setup()
  const [a, b] = await Promise.all([
    getOrCreateMcpConnection(server, opts),
    getOrCreateMcpConnection(server, opts),
  ])
  expect(a).toBe(b)
  expect(count(f, 'initialize')).toBe(1)
  expect(count(f, 'tools/list')).toBe(2)
  expect(a.tools[0]?.toolName).toBe('mcp__fixture__foo')
  expect(await callMcpTool(server, 'foo', { q: 'fixture' }, opts)).toEqual([
    { type: 'text', text: 'hello' },
  ])
  expect(count(f, 'initialize')).toBe(1)
  expect(f.requests.every((r) => r.authorization === 'Bearer SYNTHETIC_BEARER')).toBe(true)
  expect(f.requests.find((r) => r.method === 'tools/call')?.session).toBe('fixture-session')
})
test('oversized or duplicate catalogs refuse complete admission before tool dispatch', async () => {
  for (const tools of [
    Array.from({ length: 513 }, (_, i) => ({ ...fixtureTool, name: `tool_${i}` })),
    [fixtureTool, fixtureTool],
  ]) {
    const { f, server } = await setup()
    await f.changeTools(tools)
    await expect(discoverMcpTools(server, opts)).rejects.toThrow(/discovery failed/)
    expect(resources().mcp.has(server.id)).toBe(false)
    expect(count(f, 'tools/call')).toBe(0)
  }
})

test('worker host cannot forge a tool or server beyond its admitted catalog', async () => {
  const { f, server } = await setup()
  const tools = await discoverMcpTools(server, opts)
  const host = createMcpHost({
    servers: new Map([[server.id, server]]),
    tools,
    optsFor: () => opts,
  })
  await expect(host.invoke(server.id, 'not_admitted', {})).rejects.toThrow(/not admitted/)
  await expect(host.invoke('other', 'foo', {})).rejects.toThrow(/unknown MCP server/)
  expect(count(f, 'tools/call')).toBe(0)
})
test('tool-list changes retire stale turn definitions before dispatch', async () => {
  const { f, server } = await setup()
  const tools = await discoverMcpTools(server, opts)
  await vi.waitFor(() => expect(f.streamCount).toBe(1))
  await f.changeTools([{ ...fixtureTool, description: 'changed contract' }])
  await vi.waitFor(async () =>
    expect((await discoverMcpTools(server, opts))[0]?.description).toBe('changed contract'),
  )
  await expect(callMcpTool(server, 'foo', {}, { ...opts, admittedTools: tools })).rejects.toThrow(
    /changed since admission/,
  )
  await f.changeTools([])
  await vi.waitFor(async () => expect(await discoverMcpTools(server, opts)).toEqual([]))
  await expect(callMcpTool(server, 'foo', {}, opts)).rejects.toThrow(/unavailable/)
  expect(count(f, 'tools/call')).toBe(0)
})
test('disable/delete retirement during initialization cannot publish an orphan client', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  const opening = getOrCreateMcpConnection(server, opts)
  const rejected = expect(opening).rejects.toThrow(/connection or discovery failed/)
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  await closeMcpConnection(server.id)
  f.release()
  await rejected
  expect(resources().mcp.has(server.id)).toBe(false)
  await discoverMcpTools(server, opts)
  expect(count(f, 'initialize')).toBe(2)
})
test('initialization failure keeps shared retirement pending until HTTP cleanup settles', async () => {
  const { f, server } = await setup()
  f.initVersion('unsupported')
  f.delay('DELETE')
  const opening = getOrCreateMcpConnection(server, opts)
  const rejected = expect(opening).rejects.toThrow(/discovery failed/)
  await vi.waitFor(() => expect(count(f, 'DELETE')).toBe(1))
  let closed = false
  const closing = closeMcpConnection(server.id).then(() => {
    closed = true
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(closed).toBe(false)
  expect(count(f, 'initialize')).toBe(1)
  f.release()
  await closing
  await rejected
  expect(closed).toBe(true)
  expect(resources().mcp.has(server.id)).toBe(false)
})

test('shutdown includes pending connections and prevents their late publication', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  const opening = getOrCreateMcpConnection(server, opts)
  const rejected = expect(opening).rejects.toThrow()
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  await shutdownResources()
  f.release()
  await rejected
  expect(resources().mcp.size).toBe(0)
})
test('turn cancellation retires an uncertain call without replay', async () => {
  const { f, server } = await setup()
  await discoverMcpTools(server, opts)
  const controller = new AbortController()
  f.delay('tools/call')
  const call = callMcpTool(server, 'foo', {}, { ...opts, signal: controller.signal })
  const rejected = expect(call).rejects.toThrow(/may have taken effect.*Not replayed/)
  await vi.waitFor(() => expect(count(f, 'tools/call')).toBe(1))
  controller.abort()
  await rejected
  f.release()
  expect(count(f, 'tools/call')).toBe(1)
  expect(resources().mcp.has(server.id)).toBe(false)
  await expect(
    callMcpTool(server, 'foo', {}, { ...opts, signal: controller.signal }),
  ).rejects.toThrow()
  expect(count(f, 'initialize')).toBe(1)
})
test('an uncertain MCP effect blocks further server dispatch in that turn', async () => {
  const { f, server } = await setup()
  const tools = await discoverMcpTools(server, opts)
  const host = createMcpHost({
    servers: new Map([[server.id, server]]),
    tools,
    optsFor: () => opts,
  })
  f.setStatus(500)
  await expect(host.invoke(server.id, 'foo', {})).rejects.toThrow(/Not replayed/)
  await expect(host.invoke(server.id, 'foo', {})).rejects.toThrow(/uncertain effect in this turn/)
  expect(count(f, 'tools/call')).toBe(1)
  expect(count(f, 'initialize')).toBe(1)
})

test('idle reaper never closes a busy MCP call, and closes it once idle', async () => {
  const { f, server } = await setup()
  const conn = await getOrCreateMcpConnection(server, opts)
  f.delay('tools/call')
  const call = callMcpTool(server, 'foo', {}, opts)
  await vi.waitFor(() => expect(conn.busy).toBe(1))
  reapIdleResources(Date.now() + 10_000)
  expect(resources().mcp.get(server.id)).toBe(conn)
  f.release()
  await call
  reapIdleResources(Date.now() + 10_000)
  await vi.waitFor(() => expect(resources().mcp.has(server.id)).toBe(false))
})
test.each([401, 429, 500])('HTTP %i does not retry a tool POST or start OAuth', async (status) => {
  const { f, server } = await setup()
  f.setStatus(status)
  await expect(callMcpTool(server, 'foo', {}, opts)).rejects.toThrow(/Not replayed/)
  expect(count(f, 'tools/call')).toBe(1)
  expect(count(f, 'initialize')).toBe(1)
})
test.each([
  ['initialize', 'Application/JSON', 200],
  ['initialize', 'text/plain', 500],
  ['initialize', 'text/event-stream', 500],
  ['tools/call', 'text/plain', 500],
] as const)('HTTP body cap includes mixed-case JSON and error bodies (%s %s %i)', async (method, type, status) => {
  const { f, server } = await setup()
  f.oversized(method, type, status)
  await expect(callMcpTool(server, 'foo', {}, opts)).rejects.toThrow(/failed/)
  expect(count(f, method)).toBe(1)
  expect(resources().mcp.has(server.id)).toBe(false)
})

test('HTTP redirect is refused, not followed with server credentials', async () => {
  const { f, server } = await setup()
  const target = await setup()
  f.setRedirect(target.f.url)
  await expect(callMcpTool(server, 'foo', {}, opts)).rejects.toThrow(/Not replayed/)
  expect(count(f, 'tools/call')).toBe(1)
  expect(target.f.requests).toEqual([])
})
test('legacy SSE is refused before any connection or endpoint reinterpretation', async () => {
  const { f, server } = await setup()
  await expect(
    getOrCreateMcpConnection({ ...server, transport: 'sse' as never }, opts),
  ).rejects.toThrow(/Unsupported MCP transport/)
  expect(f.requests).toEqual([])
})
test('daemon revalidation after asynchronous admission prevents stale dispatch', async () => {
  const { f, server } = await setup()
  f.delay('initialize')
  let active = true
  const call = callMcpTool(
    server,
    'foo',
    {},
    {
      ...opts,
      assertActive: () => {
        if (!active) throw new Error('configuration retired')
      },
    },
  )
  const rejected = expect(call).rejects.toThrow(/configuration retired/)
  await vi.waitFor(() => expect(count(f, 'initialize')).toBe(1))
  active = false
  f.release()
  await rejected
  expect(count(f, 'tools/call')).toBe(0)
})
test.each([
  'darwin',
  'win32',
] as const)('stdio refuses before native start on controlled %s while HTTP remains available', async (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  const nativeStart = vi
    .spyOn(StdioTransport.prototype, 'start')
    .mockRejectedValue(new Error('Unexpected native stdio start'))
  const server: McpServerConfig = {
    id: `unsupported_stdio_${platform}`,
    name: 'unsupported_stdio',
    transport: 'stdio',
    command: process.execPath,
    args: [],
    url: null,
  }
  await expect(getOrCreateMcpConnection(server, opts)).rejects.toThrow(
    /stdio requires Linux.*use Streamable HTTP/,
  )
  await closeMcpConnection(server.id)
  expect(nativeStart).not.toHaveBeenCalled()
  expect(resources().mcp.has(server.id)).toBe(false)
  const { server: http } = await setup()
  expect((await discoverMcpTools(http, opts))[0]?.rawName).toBe('foo')
})

test.skipIf(process.platform !== 'linux')(
  'Pi stdio receives only daemon-supplied env and retires the whole process group',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baz-mcp-stdio-'))
    dirs.push(dir)
    const pidFile = join(dir, 'descendant.pid')
    const server: McpServerConfig = {
      id: 'stdio_fixture',
      name: 'stdio_fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [fileURLToPath(new URL('../fixtures/mcp-stdio.mjs', import.meta.url)), pidFile],
      url: null,
    }
    const old = process.env.MCP_FIXTURE_AMBIENT
    process.env.MCP_FIXTURE_AMBIENT = 'must-not-be-inherited'
    try {
      const parts = await callMcpTool(
        server,
        'foo',
        {},
        { env: { MCP_FIXTURE_SECRET: 'supplied' }, idleMs: 1000 },
      )
      const text = parts[0]?.type === 'text' ? parts[0].text : '{}'
      const result = JSON.parse(text)
      expect(result.provided).toBe('supplied')
      expect(result.ambient).toBeNull()
      const childPid = Number(readFileSync(pidFile, 'utf8'))
      await closeMcpConnection(server.id)
      await vi.waitFor(
        () => {
          const alive = (pid: number) => {
            try {
              process.kill(pid, 0)
              // Reparented Linux zombies have stopped executing; the test cannot reap init's child.
              if (
                process.platform === 'linux' &&
                /^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))
              )
                return false
              return true
            } catch {
              return false
            }
          }
          expect(alive(result.pid)).toBe(false)
          expect(alive(childPid)).toBe(false)
        },
        { timeout: 4000 },
      )
    } finally {
      if (old === undefined) delete process.env.MCP_FIXTURE_AMBIENT
      else process.env.MCP_FIXTURE_AMBIENT = old
    }
  },
)
