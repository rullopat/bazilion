import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, test } from 'vitest'
import { getDarwinProcessInspector } from '../../src/lib/process/darwin.ts'

// No platform simulation here. These checks execute public libproc on the actual Darwin runner.
test.skipIf(process.platform !== 'darwin')(
  'actual macOS libproc admits self and an owned detached child with precise birth identity',
  async () => {
    expect(process.arch).toBe('arm64')
    const inspector = getDarwinProcessInspector()
    inspector.assertReady()
    const self = inspector.member(process.pid)
    expect(self?.parent).toBe(process.ppid)
    expect(self?.start).toMatch(/^\d+:\d+:\d+$/)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
      env: {},
    })
    const closed = once(child, 'close')
    try {
      const pid = child.pid
      expect(pid).toBeTypeOf('number')
      if (!pid) throw new Error('owned fixture did not spawn')
      // The native calls are synchronous, before yielding/reaping another child into the PID.
      const member = inspector.member(pid)
      expect(member).toMatchObject({ pid, parent: process.pid, group: pid, session: pid })
      expect(member?.start).toMatch(/^\d+:\d+:\d+$/)
      expect(member?.uid).toBe(process.geteuid?.())
      expect(BigInt(member?.start.split(':')[2] ?? '0')).toBeGreaterThan(
        BigInt(self?.start.split(':')[2] ?? '0'),
      )
      await once(child, 'spawn')
      expect(inspector.member(pid)?.start).toBe(member?.start)
      expect(inspector.group(pid).map((entry) => entry.pid)).toEqual([pid])
      child.kill('SIGTERM')
      await closed
      expect(inspector.member(pid)).toBeNull()
      expect(inspector.group(pid)).toEqual([])
    } finally {
      // Only the live ChildProcess just created by this fixture is cleanup authority.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    }
  },
)
