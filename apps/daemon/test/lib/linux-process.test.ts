import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, test } from 'vitest'
import {
  getLinuxPidfdCalls,
  inspectLinuxProcess,
  parseLinuxProcessStat,
} from '../../src/lib/process/linux.ts'

function stat(start = '1234') {
  const fields = ['S', '12', '34', '34', ...Array<string>(15).fill('0'), start]
  return `34 (comm with (parentheses) and spaces) ${fields.join(' ')}\n`
}
test('Linux proc facts parse bounded numeric birth/parent/group fields, not the comm name', () => {
  expect(parseLinuxProcessStat(stat(), 34)).toEqual({
    pid: 34,
    parent: 12,
    group: 34,
    session: 34,
    start: '1234',
    state: 'S',
  })
  for (const source of [
    stat('0'),
    stat('-1'),
    stat('18446744073709551616'),
    '34 (truncated) S 12',
    stat().replace('34 (', '35 ('),
  ]) {
    expect(() => parseLinuxProcessStat(source, 34)).toThrow('unavailable')
  }
})

test.skipIf(process.platform !== 'linux')(
  'actual Linux facts and pidfds identify only the freshly spawned live child',
  async () => {
    const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
      detached: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const closed = once(child, 'close')
    let calls: ReturnType<typeof getLinuxPidfdCalls> | undefined
    let fd: number | undefined
    try {
      calls = getLinuxPidfdCalls()
      const pid = child.pid
      if (!pid) throw new Error('test child unavailable')
      const fact = inspectLinuxProcess(pid)
      expect(fact?.parent).toBe(process.pid)
      expect(fact?.group).toBe(pid)
      expect(fact?.session).toBe(pid)
      const handle = calls.open(pid)
      expect(handle.errno).toBe(0)
      expect(handle.fd).toBeGreaterThanOrEqual(0)
      fd = handle.fd
      expect(calls.state(fd)).toBe('live')
      // Actual original ChildProcess + unchanged native birth precede this controlled signal.
      expect(inspectLinuxProcess(pid)?.start).toBe(fact?.start)
      expect(child.exitCode).toBe(null)
      expect(calls.signal(fd, 'SIGTERM').result).toBe(0)
      await closed
      expect(calls.state(fd)).toBe('exited')
      expect(calls.signal(fd, 'SIGTERM').errno).toBe(3)
      calls.close(fd)
      expect(calls.state(fd)).toBe('unknown')
      fd = undefined
    } finally {
      if (fd !== undefined) calls?.close(fd)
      // Fixed trusted fixture exits on stdin EOF; no guessed-PID cleanup if admission failed.
      child.stdin?.end()
      await closed
    }
  },
  5000,
)
