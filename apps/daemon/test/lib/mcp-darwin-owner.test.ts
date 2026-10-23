import { StdioTransport } from '@earendil-works/pi-mcp'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DarwinProcessMember } from '../../src/lib/process/darwin.ts'

const fixture = vi.hoisted(() => ({
  processes: new Map<number, DarwinProcessMember>(),
  denied: false,
  ready: true,
  pid: 300 as number | undefined,
}))
vi.mock('../../src/lib/process/darwin.ts', () => ({
  getDarwinProcessInspector: () => ({
    assertReady() {
      if (!fixture.ready) throw new Error('macOS process ownership cannot be inspected')
    },
    member(pid: number) {
      if (fixture.denied) throw new Error('macOS process ownership cannot be inspected')
      const member = fixture.processes.get(pid)
      return member ? { ...member } : null
    },
    group(pid: number) {
      if (fixture.denied) throw new Error('macOS process ownership cannot be inspected')
      return [...fixture.processes.values()]
        .filter((member) => member.group === pid && member.session === pid && member.state !== 'Z')
        .map((member) => ({ ...member }))
    },
  }),
}))

import { getOrCreateMcpConnection } from '../../src/lib/mcp/pool.ts'
import { OwnedStdioTransport } from '../../src/lib/mcp/stdio-owner.ts'
import { resources } from '../../src/lib/resources.ts'

beforeEach(() => {
  fixture.denied = false
  fixture.ready = true
  fixture.pid = 300
  fixture.processes.clear()
  fixture.processes.set(300, {
    pid: 300,
    parent: process.pid,
    group: 300,
    session: 300,
    uid: 501,
    start: '1800000000:42:1000',
    state: '3',
  })
  fixture.processes.set(456, {
    pid: 456,
    parent: 300,
    group: 300,
    session: 300,
    uid: 501,
    start: '1800000000:43:1001',
    state: '3',
  })
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  vi.spyOn(StdioTransport.prototype, 'start').mockResolvedValue()
  vi.spyOn(StdioTransport.prototype, 'pid', 'get').mockImplementation(() => fixture.pid)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function change(pid: number, update: Partial<DarwinProcessMember>): void {
  const member = fixture.processes.get(pid)
  if (!member) throw new Error('missing fixture member')
  fixture.processes.set(pid, { ...member, ...update })
}

test('unavailable Darwin native inspection refuses before Pi can spawn', async () => {
  fixture.ready = false
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await expect(transport.start()).rejects.toThrow('cannot be inspected')
  expect(StdioTransport.prototype.start).not.toHaveBeenCalled()
})

test('unavailable Darwin inspection refuses pool admission before allocating a resource slot', async () => {
  fixture.ready = false
  await expect(
    getOrCreateMcpConnection(
      {
        id: 'darwin_unavailable',
        name: 'darwin_unavailable',
        transport: 'stdio',
        command: 'fixture',
        args: [],
        url: null,
      },
      { env: {}, idleMs: 1000 },
    ),
  ).rejects.toThrow('cannot be inspected')
  expect(StdioTransport.prototype.start).not.toHaveBeenCalled()
  expect(resources().mcp.has('darwin_unavailable')).toBe(false)
})

test.each([
  { start: '1800000000:44:1002' },
  { uid: 0 },
])('Darwin leader identity drift cannot authorize signalling: %j', async (update) => {
  const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
  const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.start()
  change(300, update)
  await expect(transport.close()).rejects.toThrow('ownership unknown')
  expect(signal).not.toHaveBeenCalled()
  expect(nativeClose).not.toHaveBeenCalled()
})

test('Darwin inspection failure retains ownership without unsafe native-close fallback', async () => {
  const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
  const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.start()
  fixture.denied = true
  await expect(transport.close()).rejects.toThrow('cannot be inspected')
  expect(signal).not.toHaveBeenCalled()
  expect(nativeClose).not.toHaveBeenCalled()
})

test('a Darwin descendant surviving TERM is killed only while its captured birth anchor survives', async () => {
  const nativeClose = vi.spyOn(StdioTransport.prototype, 'close').mockImplementation(async () => {
    expect(fixture.pid).toBeUndefined()
  })
  const signal = vi.spyOn(process, 'kill').mockImplementation((pid, kind) => {
    expect(pid).toBe(-300)
    if (kind === 'SIGTERM') {
      fixture.processes.delete(300)
      fixture.pid = undefined
    } else {
      expect(kind).toBe('SIGKILL')
      fixture.processes.delete(456)
    }
    return true
  })
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.start()
  await transport.close()
  expect(signal).toHaveBeenCalledTimes(2)
  expect(nativeClose).toHaveBeenCalledOnce()
})

test('Darwin anchor reuse between TERM and KILL refuses escalation and slot release', async () => {
  const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
  const signal = vi.spyOn(process, 'kill').mockImplementation((_pid, kind) => {
    expect(kind).toBe('SIGTERM')
    fixture.processes.delete(300)
    fixture.pid = undefined
    change(456, { start: '1800000000:44:1002' })
    return true
  })
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.start()
  await expect(transport.close()).rejects.toThrow('ownership changed')
  expect(signal).toHaveBeenCalledOnce()
  expect(nativeClose).not.toHaveBeenCalled()
})

test('a repeated stdio start cannot replace the original signalling authority', async () => {
  const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
  const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.start()
  change(300, { start: '1800000000:44:1002' })
  await expect(transport.start()).rejects.toThrow('already started or retired')
  expect(StdioTransport.prototype.start).toHaveBeenCalledOnce()
  await expect(transport.close()).rejects.toThrow('ownership unknown')
  expect(signal).not.toHaveBeenCalled()
  expect(nativeClose).not.toHaveBeenCalled()
})

test('a retired stdio transport cannot spawn a new process behind its settled close promise', async () => {
  fixture.pid = undefined
  vi.spyOn(StdioTransport.prototype, 'close').mockResolvedValue()
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await transport.close()
  await expect(transport.start()).rejects.toThrow('already started or retired')
  expect(StdioTransport.prototype.start).not.toHaveBeenCalled()
})

test('a Darwin server outside its freshly owned parent/session/group refuses admission', async () => {
  change(300, { parent: process.pid + 1 })
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await expect(transport.start()).rejects.toThrow('ownership unknown')
})
