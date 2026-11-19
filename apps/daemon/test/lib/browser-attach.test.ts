// BROWSER_ATTACH: finding a running browser from its DevToolsActivePort file, and the pool
// working in one. The live part runs against a real Chromium started here with remote
// debugging on a scratch profile, standing in for the operator's own browser; it is skipped
// when no browser is installed.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import {
  findRunningBrowser,
  parseDevToolsActivePort,
  runningBrowserDirs,
} from '../../src/lib/browser/attach.ts'
import type { BrowserConfig } from '../../src/lib/browser/config.ts'
import { findBrowserExecutable } from '../../src/lib/browser/executable.ts'
import {
  browserStatus,
  closeBrowserSession,
  invokeBrowserAction,
} from '../../src/lib/browser/pool.ts'
import { resources, shutdownResources } from '../../src/lib/resources.ts'
import type { ToolResultPart } from '../../src/runtime/tools/types.ts'
import { createInstrumentedOrigin, type InstrumentedOrigin } from '../fixtures/browser-managed.ts'

const root = mkdtempSync(join(tmpdir(), 'baz-browser-attach-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('a DevToolsActivePort file gives the endpoint; anything else gives none', () => {
  expect(parseDevToolsActivePort('9222\n/devtools/browser/abc-123\n')).toBe(
    'ws://127.0.0.1:9222/devtools/browser/abc-123',
  )
  for (const bad of ['', '9222', '9222\ndevtools/browser/x', '0\n/x', '70000\n/x', 'port\n/x']) {
    expect(parseDevToolsActivePort(bad)).toBeNull()
  }
})

test('the default profiles of Chrome and Chromium are searched on both systems', () => {
  expect(runningBrowserDirs('darwin', '/Users/me').map((entry) => entry.dir)).toEqual([
    '/Users/me/Library/Application Support/Google/Chrome',
    '/Users/me/Library/Application Support/Google/Chrome Beta',
    '/Users/me/Library/Application Support/Google/Chrome Canary',
    '/Users/me/Library/Application Support/Chromium',
  ])
  vi.stubEnv('XDG_CONFIG_HOME', '')
  try {
    const linux = runningBrowserDirs('linux', '/home/me').map((entry) => entry.dir)
    expect(linux).toContain('/home/me/.config/google-chrome')
    expect(linux).toContain('/home/me/.config/chromium')
    expect(linux).toContain('/home/me/snap/chromium/common/chromium')
  } finally {
    vi.unstubAllEnvs()
  }
})

test('a port file left by a browser that quit is passed over for one that listens', async () => {
  const stale = join(root, 'stale')
  const running = join(root, 'running')
  mkdirSync(stale)
  mkdirSync(running)
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected a TCP address')
  // The listener's port once it is closed again: nothing answers there.
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
  const deadPort = (closed.address() as { port: number }).port
  await new Promise((resolve) => closed.close(resolve))
  writeFileSync(join(stale, 'DevToolsActivePort'), `${deadPort}\n/devtools/browser/old`)
  writeFileSync(join(running, 'DevToolsActivePort'), `${address.port}\n/devtools/browser/new`)
  try {
    await expect(
      findRunningBrowser([
        { name: 'Stale', dir: stale },
        { name: 'Missing', dir: join(root, 'missing') },
        { name: 'Running', dir: running },
      ]),
    ).resolves.toEqual({
      name: 'Running',
      endpoint: `ws://127.0.0.1:${address.port}/devtools/browser/new`,
    })
    await expect(findRunningBrowser([{ name: 'Stale', dir: stale }])).rejects.toThrow(
      /No running Chrome or Chromium accepts remote debugging.*chrome:\/\/inspect\/#remote-debugging/,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

const available = (() => {
  try {
    findBrowserExecutable()
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!available)('agents in a running browser', () => {
  const home = join(root, 'home')
  const paths = resolvePaths(home)
  const profile = join(root, 'operator-profile')
  let chrome: ChildProcess
  let origin: InstrumentedOrigin
  let config: BrowserConfig

  const run = (
    agent: string,
    action: string,
    args: Record<string, unknown> = {},
    overrides: Partial<BrowserConfig> = {},
  ) => invokeBrowserAction(agent, action, args, { ...config, ...overrides }, paths)
  const textOf = (parts: ToolResultPart[]) =>
    parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
  /** Every tab of the browser, the operator's included, as the pool's shared connection sees it. */
  const allTabs = (agent: string) =>
    resources()
      .browsers.get(agent)
      ?.browser.context.pages()
      .map((page) => page.url())

  beforeAll(async () => {
    origin = await createInstrumentedOrigin()
    // The operator's browser, with one tab of their own open.
    chrome = spawn(
      findBrowserExecutable().path,
      [
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--use-mock-keychain',
        '--password-store=basic',
        `${origin.origin}/operator-tab`,
      ],
      { stdio: 'ignore', env: { PATH: process.env.PATH ?? '', HOME: join(root, 'operator-home') } },
    )
    const portFile = join(profile, 'DevToolsActivePort')
    await vi.waitFor(() => expect(existsSync(portFile)).toBe(true), { timeout: 20_000 })
    const endpoint = parseDevToolsActivePort(readFileSync(portFile, 'utf8'))
    if (!endpoint) throw new Error('the browser published no endpoint')
    config = {
      headless: true,
      allowPrivate: true,
      attach: true,
      attachUrl: endpoint,
      idleMs: 60_000,
      maxSessions: 4,
    }
  }, 30_000)

  afterAll(async () => {
    await shutdownResources()
    chrome?.kill('SIGKILL')
    await origin?.close()
  })

  test('the running browser is found from its profile directory', async () => {
    await expect(findRunningBrowser([{ name: 'Operator', dir: profile }])).resolves.toEqual({
      name: 'Operator',
      endpoint: config.attachUrl,
    })
  })

  test("an agent works in tabs of its own and never sees the operator's", {
    timeout: 60_000,
  }, async () => {
    expect(textOf(await run('attach-a', 'tabs', { op: 'list' }))).toBe('No tabs are open.')
    const nav = textOf(await run('attach-a', 'navigate', { url: `${origin.origin}/agent-a` }))
    expect(nav).toContain('instrumented origin')
    await run('attach-b', 'navigate', { url: `${origin.origin}/agent-b` })

    const tabsA = textOf(await run('attach-a', 'tabs', { op: 'list' }))
    expect(tabsA).toContain('/agent-a')
    expect(tabsA).not.toContain('/operator-tab')
    expect(tabsA).not.toContain('/agent-b')
    expect(textOf(await run('attach-a', 'network'))).not.toMatch(/operator-tab|agent-b/)
    // All three share the one browser.
    expect(allTabs('attach-a')).toEqual(
      expect.arrayContaining([
        `${origin.origin}/operator-tab`,
        `${origin.origin}/agent-a`,
        `${origin.origin}/agent-b`,
      ]),
    )

    const status = browserStatus('attach-a', config, paths, true)
    expect(status.running).toBe(true)
    expect(status.browser?.mode).toBe('attached')
  })

  test("stopping a session closes the agent's tabs and leaves the browser running", {
    timeout: 60_000,
  }, async () => {
    await run('attach-a', 'navigate', { url: `${origin.origin}/agent-a` })
    await run('attach-b', 'navigate', { url: `${origin.origin}/agent-b` })
    await closeBrowserSession('attach-a')

    const left = allTabs('attach-b')
    expect(left).toContain(`${origin.origin}/operator-tab`)
    expect(left).toContain(`${origin.origin}/agent-b`)
    expect(left).not.toContain(`${origin.origin}/agent-a`)
    expect(chrome.exitCode).toBeNull()

    // The last session to close drops the connection; the next call attaches again.
    await closeBrowserSession('attach-b')
    expect(chrome.exitCode).toBeNull()
    expect(textOf(await run('attach-a', 'tabs', { op: 'list' }))).toBe('No tabs are open.')
    expect(allTabs('attach-a')).toEqual([`${origin.origin}/operator-tab`])
  })

  test("private addresses and downloads are refused in the agent's tabs", {
    timeout: 60_000,
  }, async () => {
    // A public-looking page that reaches for a loopback address: nothing must arrive there.
    origin.hits.length = 0
    const page =
      `data:text/html,<img src="${origin.origin}/private-img">` +
      `<script>fetch("${origin.origin}/private-fetch",{mode:"no-cors"}).catch(()=>{}).finally(()=>{document.title="done"})</script>`
    await run('attach-guard', 'navigate', { url: page }, { allowPrivate: false })
    const guarded = resources().browsers.get('attach-guard')?.browser.pages()[0]
    await guarded?.waitForFunction('document.title === "done"')
    expect(origin.hits).toEqual([])
    await expect(
      run('attach-guard', 'navigate', { url: `${origin.origin}/direct` }, { allowPrivate: false }),
    ).rejects.toThrow(/navigation blocked/)
    await closeBrowserSession('attach-guard')

    await run('attach-dl', 'navigate', { url: `${origin.origin}/download-page` })
    const tab = resources().browsers.get('attach-dl')?.browser.pages()[0]
    if (!tab) throw new Error('the agent has no tab')
    const download = tab.waitForEvent('download')
    await tab.click('#dl')
    expect(await (await download).failure()).toBeTruthy()
  })
})
