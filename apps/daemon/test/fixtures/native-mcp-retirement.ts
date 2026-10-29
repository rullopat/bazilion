import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMcpHost } from '../../src/lib/mcp/host.ts'
import {
  callMcpTool,
  closeMcpConnection,
  discoverMcpTools,
  getOrCreateMcpConnection,
  type McpServerConfig,
} from '../../src/lib/mcp/pool.ts'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'
import { inspectLinuxProcess } from '../../src/lib/process/linux.ts'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'

/** Real standalone daemon-owned Pi MCP clients, processes and descendants; no model/network. */
export async function runNativeMcpRetirementFixture(root: string, entry: string) {
  assert(['linux', 'darwin'].includes(process.platform))
  const old = process.env.MCP_FIXTURE_AMBIENT
  process.env.MCP_FIXTURE_AMBIENT = 'must-not-be-inherited'
  const waitFor = async (predicate: () => boolean) => {
    const deadline = performance.now() + 5000
    while (!predicate() && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5))
    assert(predicate(), 'actual MCP transport marker not observed')
  }
  const inspect = (pid: number) =>
    process.platform === 'darwin'
      ? getDarwinProcessInspector().member(pid)
      : inspectLinuxProcess(pid)
  const observed: (() => void)[] = []
  const servers: McpServerConfig[] = []
  const descendant = (file: string) => {
    const pid = Number(readFileSync(file, 'utf8'))
    assert(Number.isSafeInteger(pid) && pid > 1)
    const before = inspect(pid)
    assert(before && before.state !== 'Z')
    observed.push(() => {
      const after = inspect(pid)
      assert(
        !after || after.start !== before.start || after.state === 'Z',
        'original observed descendant is still live; oracle confers no signalling authority',
      )
    })
  }
  const make = (mode: string) => {
    const file = join(root, `${mode}.pid`)
    const server: McpServerConfig = {
      id: randomUUID(),
      name: `native_${mode.replaceAll('-', '_')}`,
      transport: 'stdio',
      command: process.execPath,
      args: [entry, file, ...(mode === 'normal' ? [] : [mode])],
      url: null,
    }
    servers.push(server)
    return {
      server,
      file,
      options: {
        env: {
          PATH: '/usr/bin:/bin',
          HOME: root,
          TMPDIR: root,
          MCP_FIXTURE_SECRET: 'controlled-supplied',
        },
        idleMs: 1000,
      },
    }
  }
  let completed = false
  // A close is cached by the production pool; observing that same retirement is not a retry.
  try {
    const normal = make('normal')
    const parts = await callMcpTool(normal.server, 'foo', {}, normal.options)
    assert(parts[0]?.type === 'text')
    const result = JSON.parse(parts[0].text)
    assert.equal(result.provided, 'controlled-supplied')
    assert.equal(result.ambient, null)
    descendant(normal.file)
    await closeMcpConnection(normal.server.id)
    assert.equal(readFileSync(`${normal.file}.calls`, 'utf8'), '1')
    assert.equal(resources().mcp.has(normal.server.id), false)
    observed.at(-1)?.()

    const busy = make('hold-call'),
      controller = new AbortController(),
      options = { ...busy.options, signal: controller.signal }
    const tools = await discoverMcpTools(busy.server, options)
    const host = createMcpHost({
      servers: new Map([[busy.server.id, busy.server]]),
      tools,
      optsFor: () => options,
    })
    descendant(busy.file)
    const call = host.invoke(busy.server.id, 'foo', {})
    const outcome = call.then(
      () => ({ failed: false, error: undefined }),
      (error) => ({ failed: true, error }),
    )
    await waitFor(() => existsSync(`${busy.file}.calls`))
    assert.equal(resources().mcp.get(busy.server.id)?.busy, 1)
    reapIdleResources(Date.now() + 5000)
    assert.equal(resources().mcp.has(busy.server.id), true)
    controller.abort()
    const cancelled = await outcome
    assert(cancelled.failed)
    assert(cancelled.error instanceof Error)
    assert.match(cancelled.error.message, /may have taken effect.*Not replayed/)
    await assert.rejects(host.invoke(busy.server.id, 'foo', {}), /uncertain effect/)
    assert.equal(readFileSync(`${busy.file}.calls`, 'utf8'), '1')
    await closeMcpConnection(busy.server.id)
    assert.equal(resources().mcp.has(busy.server.id), false)
    observed.at(-1)?.()

    const opening = make('hold-initialize')
    const pending = getOrCreateMcpConnection(opening.server, opening.options).then(
      () => ({ failed: false, error: undefined }),
      (error) => ({ failed: true, error }),
    )
    await waitFor(() => existsSync(`${opening.file}.initialize`))
    descendant(opening.file)
    await closeMcpConnection(opening.server.id)
    assert((await pending).failed)
    assert.equal(resources().mcp.has(opening.server.id), false)
    assert.equal(existsSync(`${opening.file}.calls`), false)
    observed.at(-1)?.()

    const failed = make('fail-initialize')
    await assert.rejects(
      getOrCreateMcpConnection(failed.server, failed.options),
      /discovery failed/,
    )
    assert.equal(existsSync(`${failed.file}.initialize`), true)
    assert.equal(resources().mcp.has(failed.server.id), false)
    assert.equal(existsSync(`${failed.file}.calls`), false)
    assert.equal(resources().mcp.size, 0)
    await shutdownResources()
    completed = true
    return {
      node: process.version,
      platform: process.platform,
      actualStdioAdmissionAndCall: true,
      explicitEnvironmentOnly: true,
      descendantRetirementConfirmed: true,
      busyReapingRefused: true,
      busyCancellationUncertainWithoutReplay: true,
      openingRetirementCannotPublish: true,
      failedInitializationRetired: true,
      oracleConfersNoSignallingAuthority: true,
      resourcesSettled: true,
      installedClientQualified: false,
    }
  } finally {
    if (!completed) {
      for (const server of servers) await closeMcpConnection(server.id).catch(() => {})
      console.error(`Native MCP regression fixture retained: ${root}`)
    }
    if (old === undefined) delete process.env.MCP_FIXTURE_AMBIENT
    else process.env.MCP_FIXTURE_AMBIENT = old
  }
}
