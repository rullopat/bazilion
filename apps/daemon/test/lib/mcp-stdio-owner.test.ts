import { StdioTransport } from '@earendil-works/pi-mcp'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  processes: new Map<number, { start: string; state: string }>(),
  denied: false,
  pid: 123 as number | undefined,
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    readFileSync: (path: string, ...args: unknown[]) => {
      if (!path.startsWith('/proc/'))
        return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args)
      if (fixture.denied) throw Object.assign(new Error('fixture'), { code: 'EACCES' })
      const pid = Number(path.split('/')[2])
      const p = fixture.processes.get(pid)
      if (!p) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      const fields = Array<string>(20).fill('0')
      fields[0] = p.state
      fields[1] = String(process.pid)
      fields[2] = '123'
      fields[3] = '123'
      fields[19] = p.start
      return `${pid} (fixture with ) parens) ${fields.join(' ')}`
    },
    opendirSync: () => {
      const entries = [...fixture.processes.keys()]
      return {
        readSync: () => (entries.length ? { name: String(entries.shift()) } : null),
        closeSync() {},
      }
    },
  }
})

import { OwnedStdioTransport } from '../../src/lib/mcp/stdio-owner.ts'

beforeEach(() => {
  fixture.denied = false
  fixture.pid = 123
  fixture.processes.clear()
  fixture.processes.set(123, { start: '42', state: 'S' })
  fixture.processes.set(456, { start: '43', state: 'S' })
  vi.spyOn(StdioTransport.prototype, 'start').mockResolvedValue()
  vi.spyOn(StdioTransport.prototype, 'pid', 'get').mockImplementation(() => fixture.pid)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
test.each([
  'freebsd',
  'win32',
] as const)('direct owned transport refuses controlled %s before Pi can spawn', async (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  const transport = new OwnedStdioTransport({ command: 'fixture' })
  await expect(transport.start()).rejects.toThrow(/stdio requires Linux.*use Streamable HTTP/)
  expect(StdioTransport.prototype.start).not.toHaveBeenCalled()
})
test.skipIf(process.platform !== 'linux')(
  'a reused leader identity is unknown, never permission to signal its group',
  async () => {
    // Spy through to real Pi close: it must never enter its unsafe numeric-group paths.
    const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
    const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
    const transport = new OwnedStdioTransport({ command: 'fixture' })
    await transport.start()
    fixture.processes.set(123, { start: '99', state: 'S' })
    await expect(transport.close()).rejects.toThrow(/ownership unknown/)
    expect(nativeClose).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  },
)
test.skipIf(process.platform !== 'linux')(
  'inspection failure blocks unsafe native signaling and ownership release',
  async () => {
    const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
    const signal = vi.spyOn(process, 'kill').mockReturnValue(true)
    const transport = new OwnedStdioTransport({ command: 'fixture' })
    await transport.start()
    fixture.denied = true
    await expect(transport.close()).rejects.toThrow(/ownership cannot be inspected/)
    expect(nativeClose).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  },
)
test.skipIf(process.platform !== 'linux')(
  'surviving original descendants permit bounded retirement after the leader exits',
  async () => {
    const nativeClose = vi.spyOn(StdioTransport.prototype, 'close').mockImplementation(async () => {
      expect(fixture.pid).toBeUndefined()
    })
    const signal = vi.spyOn(process, 'kill').mockImplementation((pid, s) => {
      expect(pid).toBe(-123)
      if (s === 'SIGTERM') {
        fixture.processes.delete(123)
        fixture.pid = undefined
      } else {
        expect(s).toBe('SIGKILL')
        fixture.processes.delete(456)
      }
      return true
    })
    const transport = new OwnedStdioTransport({ command: 'fixture' })
    await transport.start()
    await transport.close()
    expect(signal).toHaveBeenCalledTimes(2)
    expect(nativeClose).toHaveBeenCalledOnce()
  },
)
test.skipIf(process.platform !== 'linux')(
  'identity drift between TERM and KILL refuses escalation and native close',
  async () => {
    const nativeClose = vi.spyOn(StdioTransport.prototype, 'close')
    const signal = vi.spyOn(process, 'kill').mockImplementation((_pid, s) => {
      expect(s).toBe('SIGTERM')
      fixture.processes.delete(123)
      fixture.pid = undefined
      fixture.processes.set(456, { start: '99', state: 'S' })
      return true
    })
    const transport = new OwnedStdioTransport({ command: 'fixture' })
    await transport.start()
    await expect(transport.close()).rejects.toThrow(/ownership changed/)
    expect(signal).toHaveBeenCalledOnce()
    expect(nativeClose).not.toHaveBeenCalled()
  },
)
