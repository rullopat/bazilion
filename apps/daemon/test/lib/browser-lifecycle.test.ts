// Pool lifecycle with a fake launcher: one launch per agent, busy browsers are
// never reaped or evicted, capacity, relaunch on change, cancellation, stop,
// reset, status and bounded results. Real-browser behaviour lives in
// browser-live.test.ts.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import type { BrowserConfig } from '../../src/lib/browser/config.ts'
import type { LaunchedBrowser, LaunchOptions } from '../../src/lib/browser/launch.ts'
import { MAX_TEXT_CHARS } from '../../src/lib/browser/snapshot.ts'

interface FakeBrowser extends LaunchedBrowser {
  closed: boolean
  alive: boolean
}

const launched: FakeBrowser[] = []
let releaseNavigation: (() => void) | null = null
let failLaunch: string | null = null
// What the fake page reports, and every selector the pool asked it for.
let pageTitle = 'Example'
let pageUrl = 'https://example.test/'
let navigationError: string | null = null
const touched: string[] = []

vi.mock('../../src/lib/browser/executable.ts', () => ({
  findBrowserExecutable: () => ({ path: '/fake/chromium', name: 'Fake Chromium' }),
}))
// The real orphan killer stays: reset must use it.
vi.mock('../../src/lib/browser/launch.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/browser/launch.ts')>()),
  launchBrowser: async (opts: LaunchOptions): Promise<LaunchedBrowser> => {
    if (failLaunch) throw new Error(failLaunch)
    mkdirSync(join(opts.dir, 'user-data'), { recursive: true })
    const page = {
      url: () => pageUrl,
      title: async () => pageTitle,
      goto: () =>
        navigationError
          ? Promise.reject(new Error(navigationError))
          : new Promise<void>((resolve) => {
              releaseNavigation = resolve
            }),
      locator: (selector: string) => {
        touched.push(selector)
        return { ariaSnapshot: async () => '- heading "Example"' }
      },
    }
    const browser: FakeBrowser = {
      closed: false,
      alive: true,
      context: { pages: () => [page], on: () => {} } as unknown as LaunchedBrowser['context'],
      get running() {
        return browser.alive
      },
      async close() {
        browser.closed = true
      },
    }
    launched.push(browser)
    return browser
  },
}))

const {
  browserStatus,
  closeBrowserSession,
  invokeBrowserAction,
  reapIdleBrowserSessions,
  removeBrowserProfile,
} = await import('../../src/lib/browser/pool.ts')
const { createBrowserHost } = await import('../../src/lib/browser/host.ts')
const { resources, shutdownResources } = await import('../../src/lib/resources.ts')

const home = mkdtempSync(join(tmpdir(), 'baz-browser-pool-'))
const paths = resolvePaths(home)
afterAll(() => rmSync(home, { recursive: true, force: true }))

afterEach(async () => {
  releaseNavigation?.()
  releaseNavigation = null
  await shutdownResources()
  launched.length = 0
  failLaunch = null
  pageTitle = 'Example'
  pageUrl = 'https://example.test/'
  navigationError = null
  touched.length = 0
})

function config(overrides: Partial<BrowserConfig> = {}): BrowserConfig {
  return { headless: true, allowPrivate: true, idleMs: 60_000, maxSessions: 4, ...overrides }
}

const run = (agent: string, cfg = config(), signal?: AbortSignal) =>
  invokeBrowserAction(agent, 'console', {}, cfg, paths, signal)

/** Start a navigation that stays in flight until `releaseNavigation()`. */
async function holdBusy(agent: string, cfg = config()) {
  releaseNavigation = null
  const done = invokeBrowserAction(agent, 'navigate', { url: 'https://example.test/' }, cfg, paths)
  await vi.waitFor(() => expect(releaseNavigation).not.toBeNull())
  return { done }
}

test('concurrent first calls for one agent launch one browser', async () => {
  await Promise.all([run('a'), run('a'), run('a')])
  expect(launched).toHaveLength(1)
})

test('at capacity the least recently used idle browser makes room', async () => {
  const cfg = config({ maxSessions: 2 })
  await run('a', cfg)
  await run('b', cfg)
  const sessions = resources().browsers
  for (const [agent, lastUsedAt] of [
    ['a', 2],
    ['b', 1],
  ] as const) {
    const session = sessions.get(agent)
    if (session) session.lastUsedAt = lastUsedAt
  }
  await run('c', cfg)
  expect(launched[1]?.closed).toBe(true)
  expect([...resources().browsers.keys()].sort()).toEqual(['a', 'c'])
})

test('a busy browser survives the reaper and eviction; a full busy pool refuses', async () => {
  const cfg = config({ maxSessions: 1, idleMs: 1 })
  const navigation = await holdBusy('a', cfg)
  reapIdleBrowserSessions(Date.now() + 10_000)
  await expect(run('b', cfg)).rejects.toThrow(/All 1 browser sessions are in use/)
  expect(launched[0]?.closed).toBe(false)
  releaseNavigation?.()
  await navigation.done
  reapIdleBrowserSessions(Date.now() + 10_000)
  expect(launched[0]?.closed).toBe(true)
})

test('changed settings or a browser that died relaunch on the next call', async () => {
  await run('a')
  await run('a', config({ headless: false }))
  expect(launched).toHaveLength(2)
  expect(launched[0]?.closed).toBe(true)
  const second = launched[1] as FakeBrowser
  second.alive = false
  // Still registered, but a dead browser does not read as running.
  expect(browserStatus('a', config(), paths, true).running).toBe(false)
  await run('a', config({ headless: false }))
  expect(launched).toHaveLength(3)
  expect(second.closed).toBe(true)
})

test('a new idle timeout applies to a running browser without a restart', async () => {
  await run('a', config({ idleMs: 60_000 }))
  await run('a', config({ idleMs: 1 }))
  expect(launched).toHaveLength(1)
  reapIdleBrowserSessions(Date.now() + 1_000)
  expect(launched[0]?.closed).toBe(true)
})

test('a cancelled turn neither launches nor closes the browser', async () => {
  await run('a')
  const cancelled = AbortSignal.abort()
  await expect(run('a', config(), cancelled)).rejects.toThrow(/aborted/)
  await expect(run('b', config(), cancelled)).rejects.toThrow(/aborted/)
  expect(launched).toHaveLength(1)
  expect(launched[0]?.closed).toBe(false)
})

test('cancelling a turn mid-action stops the browser, so the next call does not wait', async () => {
  const turn = new AbortController()
  const navigation = invokeBrowserAction(
    'a',
    'navigate',
    { url: 'https://example.test/' },
    config(),
    paths,
    turn.signal,
  )
  await vi.waitFor(() => expect(releaseNavigation).not.toBeNull())
  turn.abort()
  await expect(navigation).rejects.toThrow(/aborted/)
  expect(launched[0]?.closed).toBe(true)
  await run('a')
  expect(launched).toHaveLength(2)
})

test('type and fill_form refuse a non-string value before touching the page', async () => {
  const act = (action: string, args: Record<string, unknown>) =>
    invokeBrowserAction('a', action, args, config(), paths)
  await expect(act('type', { ref: 'e1', text: 5 })).rejects.toThrow(/"text" must be a string/)
  await expect(
    act('fill_form', {
      fields: [
        { ref: 'e1', value: 'ok' },
        { ref: 'e2', value: null },
      ],
    }),
  ).rejects.toThrow(/value for e2 must be a string/)
  expect(touched).toEqual([])
})

test('a hostile page cannot flood a result or an error', async () => {
  pageTitle = 't'.repeat(100_000)
  pageUrl = `https://example.test/${'u'.repeat(2_000_000)}`
  const [snapshot] = await invokeBrowserAction('a', 'snapshot', {}, config(), paths)
  expect(snapshot?.type === 'text' && snapshot.text.length).toBeLessThan(1_500)
  const [tabList] = await invokeBrowserAction('a', 'tabs', { op: 'list' }, config(), paths)
  expect(tabList?.type === 'text' && tabList.text.length).toBeLessThan(1_000)

  navigationError = `page.goto: interrupted by another navigation to "${pageUrl}"`
  const error = await invokeBrowserAction(
    'a',
    'navigate',
    { url: 'https://example.test/' },
    config(),
    paths,
  ).catch((caught: unknown) => caught as Error)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(/^page\.goto: interrupted/)
  expect((error as Error).message.length).toBeLessThan(MAX_TEXT_CHARS + 50)
})

test('stop does not wait for a call in flight', async () => {
  const navigation = await holdBusy('a')
  await closeBrowserSession('a')
  expect(launched[0]?.closed).toBe(true)
  expect(resources().browsers.has('a')).toBe(false)
  releaseNavigation?.()
  await navigation.done
})

test('a call the browser never answers is cut off and the browser stopped', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const navigation = await holdBusy('a')
    const failed = expect(navigation.done).rejects.toThrow(/did not answer in time/)
    await vi.advanceTimersByTimeAsync(120_000)
    await failed
    expect(launched[0]?.closed).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test("a turn's browser host drives that turn's agent, whatever id the worker sends", async () => {
  const host = createBrowserHost(config(), { agentId: 'turn-agent', paths })
  await host.invoke('forged-agent', 'console', {})
  expect([...resources().browsers.keys()]).toEqual(['turn-agent'])
  const cancelled = createBrowserHost(config(), {
    agentId: 'turn-agent',
    paths,
    signal: AbortSignal.abort(),
  })
  await expect(cancelled.invoke('turn-agent', 'console', {})).rejects.toThrow(/aborted/)
})

test('stop keeps the profile; reset deletes it', async () => {
  await run('a')
  await closeBrowserSession('a')
  expect(launched[0]?.closed).toBe(true)
  expect(existsSync(paths.browserDir('a'))).toBe(true)
  await removeBrowserProfile('a', paths)
  expect(existsSync(paths.browserDir('a'))).toBe(false)
})

test('reset kills a browser that a dead daemon left running on the profile', async () => {
  const userDataDir = join(paths.browserDir('o'), 'user-data')
  mkdirSync(userDataDir, { recursive: true })
  // Stands in for the orphaned browser: a long-lived process whose argv names the profile.
  const orphan = spawn('sh', ['-c', 'sleep 60; :', 'sh', `--user-data-dir=${userDataDir}`], {
    detached: true,
    stdio: 'ignore',
  })
  const exited = new Promise((resolve) => orphan.once('exit', resolve))
  symlinkSync(`${hostname()}-${orphan.pid}`, join(userDataDir, 'SingletonLock'))
  await removeBrowserProfile('o', paths)
  await expect(exited).resolves.toBeDefined()
  expect(existsSync(paths.browserDir('o'))).toBe(false)
})

test('status reports the session, the profile, the browser and the last launch error', async () => {
  rmSync(paths.browserDir('s'), { recursive: true, force: true })
  expect(browserStatus('s', config(), paths, true)).toEqual({
    agentId: 's',
    enabled: true,
    running: false,
    profilePresent: false,
    browser: { name: 'Fake Chromium', mode: 'headless' },
  })
  failLaunch = 'the browser exited during startup (exit code 1)'
  await expect(run('s')).rejects.toThrow(/exited during startup/)
  expect(browserStatus('s', config(), paths, true).error).toBe(failLaunch)
  failLaunch = null
  await run('s')
  expect(browserStatus('s', config({ headless: false }), paths, false)).toEqual({
    agentId: 's',
    enabled: false,
    running: true,
    profilePresent: true,
    browser: { name: 'Fake Chromium', mode: 'headed' },
  })
})
