import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  assertDaemonStopped,
  claimDaemonPidFile,
  DAEMON_PID_FILE,
  runningDaemonPid,
} from '../../src/lib/daemon-liveness.ts'

let home: string
let pidfile: string
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), 'bazilion-pidfile-')), 'home')
  pidfile = join(home, DAEMON_PID_FILE)
})
afterEach(() => rmSync(join(home, '..'), { recursive: true, force: true }))

function exitedProcessId(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  })
  return Number.parseInt(result.stdout, 10)
}

test('the daemon claims a home with a pidfile and releases it on shutdown', () => {
  expect(runningDaemonPid(home)).toBeNull()
  const release = claimDaemonPidFile(home)
  expect(readFileSync(pidfile, 'utf8')).toBe(`${process.pid}\n`)
  release()
  expect(existsSync(pidfile)).toBe(false)
})

test('a pidfile naming another live process refuses a second daemon, restore and uninstall', async () => {
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const exited = new Promise((resolve) => other.once('close', resolve))
  try {
    mkdirSync(home)
    writeFileSync(pidfile, `${other.pid}\n`)
    expect(runningDaemonPid(home)).toBe(other.pid)
    expect(() => claimDaemonPidFile(home)).toThrow(
      `a bazilion daemon (pid ${other.pid}) is running`,
    )
    expect(() => assertDaemonStopped(home)).toThrow(`if none is running, delete ${pidfile}`)
    expect(readFileSync(pidfile, 'utf8')).toBe(`${other.pid}\n`)
  } finally {
    other.kill('SIGKILL')
    await exited
  }
})

test.each([
  ['names a process that has exited', () => `${exitedProcessId()}\n`],
  ['is not a PID', () => 'garbage'],
  ['names this process, its PID reused after a reboot', () => `${process.pid}\n`],
])('a pidfile that %s is stale and replaced', (_name, content) => {
  mkdirSync(home)
  writeFileSync(pidfile, content())
  expect(runningDaemonPid(home)).toBeNull()
  expect(() => assertDaemonStopped(home)).not.toThrow()
  const release = claimDaemonPidFile(home)
  expect(readFileSync(pidfile, 'utf8')).toBe(`${process.pid}\n`)
  release()
  expect(existsSync(pidfile)).toBe(false)
})

test('release leaves a pidfile that another daemon wrote', () => {
  const release = claimDaemonPidFile(home)
  writeFileSync(pidfile, '4242\n')
  release()
  expect(readFileSync(pidfile, 'utf8')).toBe('4242\n')
})
