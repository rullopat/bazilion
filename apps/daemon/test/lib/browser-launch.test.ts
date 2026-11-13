// The launcher against fake browser executables (shell scripts): what the child
// is given, what a failed start reports, and the profile it prepares. The real
// browser is exercised by browser-live.test.ts.

import { spawn } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import { launchBrowser } from '../../src/lib/browser/launch.ts'

const root = mkdtempSync(join(tmpdir(), 'baz-browser-launch-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function fakeBrowser(name: string, body: string): string {
  const path = join(root, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('the child gets the profile, the proxy and a scrubbed environment', async () => {
  const dir = join(root, 'agent-env')
  const out = join(root, 'env-out')
  const executablePath = fakeBrowser(
    'record.sh',
    `printf '%s\\n' "$@" > ${out}.args; env > ${out}.env; exit 3`,
  )
  process.env.BAZILION_TEST_SECRET = 'must-not-leak'
  try {
    await expect(
      launchBrowser({ executablePath, dir, headless: true, proxyUrl: 'http://127.0.0.1:9' }),
    ).rejects.toThrow(/exited during startup \(exit code 3\)/)
  } finally {
    delete process.env.BAZILION_TEST_SECRET
  }
  const args = readFileSync(`${out}.args`, 'utf8').trim().split('\n')
  expect(args).toEqual(
    expect.arrayContaining([
      '--remote-debugging-port=0',
      `--user-data-dir=${join(dir, 'user-data')}`,
      '--headless=new',
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      'about:blank',
    ]),
  )
  const env = readFileSync(`${out}.env`, 'utf8')
  expect(env).toContain(`HOME=${join(dir, 'home')}`)
  expect(env).not.toContain('must-not-leak')
  expect(env).not.toMatch(/^DISPLAY=/m)
})

/** True once `pid` is gone (or a zombie waiting to be reaped). */
function isGone(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z') ?? true
  } catch {
    return true
  }
}

test('a helper the browser started dies with it', async () => {
  const out = join(root, 'helper-pid')
  const executablePath = fakeBrowser('helper.sh', `sleep 60 & echo $! > ${out}; exit 4`)
  await expect(
    launchBrowser({ executablePath, dir: join(root, 'agent-helper'), headless: true }),
  ).rejects.toThrow(/exit code 4/)
  const helper = Number(readFileSync(out, 'utf8'))
  await vi.waitFor(() => expect(isGone(helper)).toBe(true))
})

test('a browser that exits during startup fails with its own stderr', async () => {
  const executablePath = fakeBrowser(
    'no-display.sh',
    'echo "ERROR: Missing X server or $DISPLAY" >&2; exit 1',
  )
  await expect(
    launchBrowser({ executablePath, dir: join(root, 'agent-fail'), headless: false }),
  ).rejects.toThrow(/exited during startup \(exit code 1\):\nERROR: Missing X server/)
})

test('the profile is private and set to open a blank tab, keeping other preferences', async () => {
  const dir = join(root, 'agent-prefs')
  mkdirSync(join(dir, 'user-data', 'Default'), { recursive: true })
  writeFileSync(
    join(dir, 'user-data', 'Default', 'Preferences'),
    JSON.stringify({ intl: { accept_languages: 'it' }, profile: { name: 'Baziu' } }),
  )
  const executablePath = fakeBrowser('exit.sh', 'exit 0')
  await expect(launchBrowser({ executablePath, dir, headless: true })).rejects.toThrow()
  expect(statSync(join(dir, 'home')).mode & 0o777).toBe(0o700)
  const prefs = JSON.parse(readFileSync(join(dir, 'user-data', 'Default', 'Preferences'), 'utf8'))
  expect(prefs).toEqual({
    intl: { accept_languages: 'it' },
    profile: { name: 'Baziu', exit_type: 'Normal', exited_cleanly: true },
    session: { restore_on_startup: 5 },
  })
})

test('a new profile directory is created owner-only', async () => {
  const dir = join(root, 'agent-new')
  const executablePath = fakeBrowser('exit-new.sh', 'exit 0')
  await expect(launchBrowser({ executablePath, dir, headless: true })).rejects.toThrow()
  for (const created of [dir, join(dir, 'user-data'), join(dir, 'home')]) {
    expect(statSync(created).mode & 0o777).toBe(0o700)
  }
})

test('a browser left running on the profile by a dead daemon is killed first', async () => {
  const dir = join(root, 'agent-orphan')
  const userDataDir = join(dir, 'user-data')
  mkdirSync(userDataDir, { recursive: true })
  // Stands in for the orphaned browser: a long-lived process whose argv names the profile.
  const orphan = spawn('sh', ['-c', 'sleep 60; :', 'sh', `--user-data-dir=${userDataDir}`], {
    detached: true,
    stdio: 'ignore',
  })
  const exited = new Promise((resolve) => orphan.once('exit', resolve))
  symlinkSync(`${hostname()}-${orphan.pid}`, join(userDataDir, 'SingletonLock'))
  const executablePath = fakeBrowser('exit-again.sh', 'exit 0')
  await expect(launchBrowser({ executablePath, dir, headless: true })).rejects.toThrow()
  await expect(exited).resolves.toBeDefined()
})
