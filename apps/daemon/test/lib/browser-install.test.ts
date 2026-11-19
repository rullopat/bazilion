// The Chromium download with a fake installer process: when it runs, that concurrent callers
// share it, and what a failure reports.

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let installed = false
const installs: Array<{ args: string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = []

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const child = new FakeChild()
    installs.push({ args, env: options.env, child })
    return child
  },
}))
vi.mock('../../src/lib/browser/executable.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/browser/executable.ts')>()
  return {
    ...original,
    findBrowserExecutable: (configuredPath?: string) => {
      if (configuredPath) throw new Error(`BROWSER_EXECUTABLE_PATH is not an executable file`)
      if (!installed) throw new Error(original.NO_BROWSER_FOUND)
      return { path: '/cache/chromium', name: 'Chromium (Playwright)' }
    },
  }
})

const { browserDownloadNote, ensureBrowserExecutable } = await import(
  '../../src/lib/browser/install.ts'
)

beforeEach(() => {
  vi.stubEnv('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '')
  vi.stubEnv('BAZILION_TEST_SECRET', 'must-not-leak')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  installed = false
  installs.length = 0
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('a machine without a browser downloads Chromium once, however many agents ask', async () => {
  const first = ensureBrowserExecutable()
  const second = ensureBrowserExecutable()
  await vi.waitFor(() => expect(installs).toHaveLength(1))
  const install = installs[0]
  if (!install) throw new Error('no installer started')
  // Full Chromium only: the daemon never launches the headless shell.
  expect(install.args.slice(1)).toEqual(['install', '--no-shell', '--no-progress', 'chromium'])
  expect(install.args[0]).toMatch(/playwright[\\/]cli\.js$/)
  expect(install.env.BAZILION_TEST_SECRET).toBeUndefined()
  expect(install.env.PATH).toBe(process.env.PATH)
  expect(browserDownloadNote()).toMatch(/being downloaded/)

  installed = true
  install.child.emit('exit', 0, null)
  const found = { path: '/cache/chromium', name: 'Chromium (Playwright)' }
  expect(await first).toEqual(found)
  expect(await second).toEqual(found)
  expect(browserDownloadNote()).toBeNull()

  // With a browser in place nothing is downloaded again.
  expect(await ensureBrowserExecutable()).toEqual(found)
  expect(installs).toHaveLength(1)
})

test('a failed download says why, in the error and in the status note', async () => {
  const pending = ensureBrowserExecutable()
  await vi.waitFor(() => expect(installs).toHaveLength(1))
  installs[0]?.child.stderr.emit('data', Buffer.from('getaddrinfo ENOTFOUND cdn.playwright.dev\n'))
  installs[0]?.child.emit('exit', 1, null)
  await expect(pending).rejects.toThrow(
    /No browser found.*Downloading Chromium failed: getaddrinfo ENOTFOUND/s,
  )
  expect(browserDownloadNote()).toMatch(/Downloading Chromium failed: getaddrinfo ENOTFOUND/)

  // The next call tries again.
  const retry = ensureBrowserExecutable()
  await vi.waitFor(() => expect(installs).toHaveLength(2))
  installed = true
  installs[1]?.child.emit('exit', 0, null)
  await expect(retry).resolves.toMatchObject({ path: '/cache/chromium' })
})

test('nothing is downloaded for a configured path or when downloads are switched off', async () => {
  await expect(ensureBrowserExecutable('/missing/browser')).rejects.toThrow(
    /BROWSER_EXECUTABLE_PATH/,
  )
  vi.stubEnv('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '1')
  await expect(ensureBrowserExecutable()).rejects.toThrow(/No browser found/)
  expect(installs).toHaveLength(0)
})
