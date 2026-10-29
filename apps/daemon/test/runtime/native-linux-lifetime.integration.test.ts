import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { getLinuxPidfdCalls, inspectLinuxProcess } from '../../src/lib/process/linux.ts'
import { nativeLinuxDomainFixture } from '../fixtures/native-linux-domain.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
async function marker(workspace: string) {
  const path = join(workspace, 'escaped-marker')
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    try {
      const text = readFileSync(path, 'utf8')
      if (text.includes('\n') && text.endsWith('x')) {
        const observation = JSON.parse(text.split('\n')[0] ?? '') as Record<string, unknown>
        expect(observation.parent).toBe(1)
        expect(observation.group).toBe(observation.session)
        expect(observation.pid).not.toBe(observation.group)
        expect(observation.stdioClosed).toBe(true)
        return path
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Detached writer did not acknowledge within the fixture bound')
}
async function stable(path: string) {
  const before = statSync(path).size
  await new Promise((resolve) => setTimeout(resolve, 75))
  expect(statSync(path).size).toBe(before)
}

test.skipIf(!enabled)(
  'early Bubblewrap creation JSON cannot acknowledge readiness before trusted sandboxed exec',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      let observed = false
      const run = await fixture.start(undefined, {
        beforeSpawn() {},
        bind() {},
        async beforeEntry(owner) {
          let ready = false
          void owner.ready.then(() => {
            ready = true
          })
          const deadline = performance.now() + 1500
          while (!owner.observation().creationReported && performance.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 10))
          expect(owner.observation().creationReported).toBe(true)
          expect(owner.observation().entrySeen).toBe(false)
          expect(owner.observation().acknowledged).toBe(false)
          expect(ready).toBe(false)
          observed = true
        },
      })
      expect(observed).toBe(true)
      await run.release('exit 0\n')
      expect(await run.waitSettled()).toBe(true)
      expect(run.finish()).toBe(true)
      fixture.cleanup()
    } catch (cause) {
      throw new Error(`Native early-ack boundary failed; retained ${fixture.root}`, { cause })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'namespace-init death retires a double-fork/setsid writer with closed pipes after normal leader exit',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      const run = await fixture.start(['--noprofile', '--norc', '-s', '--', fixture.probe])
      await run.release(
        '"$1" escaped-writer\nwhile [ ! -s escaped-marker ]; do sleep .01; done\nsleep .05\nexit 0\n',
      )
      const path = await marker(run.workspace)
      expect(await run.waitSettled(), run.stderr).toBe(true)
      expect(run.child.exitCode).toBe(0)
      await stable(path)
      expect(run.finish()).toBe(true)
      fixture.cleanup()
    } catch (cause) {
      throw new Error(`Native normal-exit lifetime failed; retained ${fixture.root}`, { cause })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'live pidfd cancellation kills the private domain including a SIGTERM-ignoring detached writer',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      const run = await fixture.start(['--noprofile', '--norc', '-s', '--', fixture.probe])
      await run.release('trap "" TERM\n"$1" escaped-writer\nwhile :; do sleep .02; done\n')
      const path = await marker(run.workspace)
      const started = performance.now()
      expect(await run.owner.terminate(), JSON.stringify(run.owner.observation())).toBe(true)
      expect(performance.now() - started).toBeLessThan(3500)
      expect(await run.waitSettled(), run.stderr).toBe(true)
      await stable(path)
      expect(run.finish()).toBe(true)
      fixture.cleanup()
    } catch (cause) {
      throw new Error(`Native cancellation failed; retained ${fixture.root}`, { cause })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'owned manager crash cannot leave an escaped writer alive or turn the command into success',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      const run = await fixture.start(['--noprofile', '--norc', '-s', '--', fixture.probe])
      await run.release('"$1" escaped-writer\nwhile :; do sleep .02; done\n')
      const path = await marker(run.workspace)
      const pid = run.child.pid
      if (!pid || run.child.exitCode !== null || run.child.signalCode !== null)
        throw new Error('Original manager is not live')
      const original = inspectLinuxProcess(pid)
      if (!original || original.parent !== process.pid)
        throw new Error('Original manager authority unavailable')
      const calls = getLinuxPidfdCalls()
      const handle = calls.open(pid)
      if (handle.fd < 0 || handle.errno) throw new Error('Original manager pidfd unavailable')
      try {
        expect(inspectLinuxProcess(pid)?.start).toBe(original.start)
        expect(calls.state(handle.fd)).toBe('live')
        expect(calls.signal(handle.fd, 'SIGKILL').result).toBe(0)
      } finally {
        calls.close(handle.fd)
      }
      expect(await run.waitSettled(), run.stderr).toBe(true)
      expect(run.child.signalCode).toBe('SIGKILL')
      expect(run.child.exitCode).toBe(null)
      await stable(path)
      expect(run.finish()).toBe(true)
      fixture.cleanup()
    } catch (cause) {
      throw new Error(`Native manager-crash failed; retained ${fixture.root}`, { cause })
    }
  },
  15_000,
)

test.skipIf(!enabled)(
  'local status transport retirement stays unknown even when the command later exits',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      const run = await fixture.start()
      await run.owner.ready
      run.child.stdio[4]?.destroy()
      await run.release('exit 0\n')
      await run.closed
      expect(run.owner.isSettled()).toBe(false)
      expect(run.finish()).toBe(false)
      expect(() => fixture.cleanup()).toThrow('ownership unknown')
      // Deliberately retained: neither destroy() nor a disappeared process authorizes force release.
    } catch (cause) {
      throw new Error(`Native lost-transport assertion failed; retained ${fixture.root}`, { cause })
    }
  },
  15_000,
)
