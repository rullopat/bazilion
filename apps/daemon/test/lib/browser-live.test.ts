// The browser against a real Chromium (whatever findBrowserExecutable picks): the
// pool's pages, refs, paging, tabs, profile persistence, stop and reset, and the
// launch-level network and profile controls. Skipped when no browser is installed.

import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import type { BrowserConfig } from '../../src/lib/browser/config.ts'
import { findBrowserExecutable } from '../../src/lib/browser/executable.ts'
import { type AgentBrowser, launchBrowser } from '../../src/lib/browser/launch.ts'
import {
  browserStatus,
  closeBrowserSession,
  invokeBrowserAction,
  removeBrowserProfile,
} from '../../src/lib/browser/pool.ts'
import { closeSsrfProxy, getSsrfProxy } from '../../src/lib/browser/proxy.ts'
import { resources, shutdownResources } from '../../src/lib/resources.ts'
import type { ToolResultPart } from '../../src/runtime/tools/types.ts'
import {
  browserProcesses,
  createInstrumentedOrigin,
  type InstrumentedOrigin,
} from '../fixtures/browser-managed.ts'

const available = (() => {
  try {
    findBrowserExecutable()
    return true
  } catch {
    return false
  }
})()

// Loopback test pages, so the SSRF proxy is off.
const CONFIG: BrowserConfig = {
  headless: true,
  allowPrivate: true,
  attach: false,
  idleMs: 60_000,
  maxSessions: 4,
}
const home = mkdtempSync(join(tmpdir(), 'baz-browser-live-'))
const paths = resolvePaths(home)
let server: Server
let origin = ''

const html = (body: string) =>
  `<!doctype html><html><head><title>Live</title></head><body>${body}</body></html>`
const PAGES: Record<string, string> = {
  '/hello': html('<h1>Hello Bazilion</h1><button>Go</button>'),
  // Text changing every 20 ms must not get in the way of a click.
  '/ticker': html(
    '<p id="tick">0</p><p id="result">waiting</p>' +
      "<button onclick=\"document.getElementById('result').textContent = 'clicked'\">Press</button>" +
      '<input aria-label="Query">' +
      "<script>let n = 0; setInterval(() => { document.getElementById('tick').textContent = String(++n) }, 20)</script>",
  ),
  // A page of an app under test: an error in the console, an uncaught one, a failed request,
  // text that shows late, and a file to download.
  '/app': html(
    '<h1>App</h1><main id="main"><p>Readable article text for the reader.</p></main>' +
      '<p id="later"></p><a id="dl" href="/report.csv">Report</a>' +
      "<script>console.error('boom in console'); fetch('/missing-api'); " +
      "setTimeout(() => { document.getElementById('later').textContent = 'Loaded late' }, 600); " +
      "setTimeout(() => { throw new Error('uncaught boom') }, 50)</script>",
  ),
  '/media': html(
    "<meta name='viewport' content='width=device-width'><p id='m'></p><script>document.getElementById('m').textContent = [matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', innerWidth, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|')</script>",
  ),
  '/long': html(
    Array.from(
      { length: 1500 },
      (_, i) => `<p>paragraph number ${i} with some filler text</p>`,
    ).join(''),
  ),
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/set-cookie') {
      res.setHeader('set-cookie', 'baziu=purr; Max-Age=3600; Path=/')
      res.end(html('<p>cookie set</p>'))
      return
    }
    if (req.url === '/report.csv') {
      res.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="report.csv"',
      })
      res.end('a,b\n1,2\n')
      return
    }
    if (req.url === '/show-cookie') {
      res.end(html(`<p>cookie: ${req.headers.cookie ?? 'none'}</p>`))
      return
    }
    const page = PAGES[req.url ?? '']
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html' }).end(page ?? 'not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await shutdownResources()
  await new Promise((resolve) => server.close(resolve))
  rmSync(home, { recursive: true, force: true })
})

const run = (agent: string, action: string, args: Record<string, unknown> = {}) =>
  invokeBrowserAction(agent, action, args, CONFIG, paths)
const textOf = (parts: ToolResultPart[]) =>
  parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
const refOf = (snapshot: string, pattern: RegExp) => {
  const ref = pattern.exec(snapshot)?.[1]
  if (!ref) throw new Error(`no ref matching ${pattern} in:\n${snapshot}`)
  return ref
}

const processesOf = (agent: string) => browserProcesses(join(paths.browserDir(agent), 'user-data'))

const live = test.skipIf(!available)

live(
  'navigate, snapshot and screenshot a page in one reused browser',
  async () => {
    const nav = textOf(await run('live-a', 'navigate', { url: `${origin}/hello` }))
    expect(nav).toContain('- Page title: Live')
    expect(nav).toContain('Hello Bazilion')
    expect(nav).toMatch(/button "Go" \[ref=e\d+\]/)
    const session = resources().browsers.get('live-a')

    const shot = await run('live-a', 'take_screenshot')
    const image = shot.find((part) => part.type === 'image')
    expect(image?.type === 'image' && image.mimeType).toBe('image/png')
    expect(textOf(await run('live-a', 'snapshot'))).toContain('Hello Bazilion')
    expect(textOf(await run('live-a', 'network'))).toContain(`GET 200 ${origin}/hello`)
    expect(resources().browsers.get('live-a')).toBe(session)
  },
  120_000,
)

live(
  'errors, network, text, wait, element screenshot, PDF and a download, for a page under test',
  async () => {
    await run('live-app', 'navigate', { url: `${origin}/app` })
    const waited = textOf(await run('live-app', 'wait', { seconds: 10, text: 'Loaded late' }))
    expect(waited).toContain('Done waiting for "Loaded late" to show')
    const errors = textOf(await run('live-app', 'errors'))
    expect(errors).toContain('boom in console')
    expect(errors).toContain('[uncaught] uncaught boom')
    // Read once: asked again, there is nothing new.
    expect(textOf(await run('live-app', 'errors'))).toMatch(/^No console errors/)
    expect(textOf(await run('live-app', 'network', { filter: 'missing' }))).toBe(
      `GET 404 ${origin}/missing-api`,
    )
    expect(textOf(await run('live-app', 'text'))).toContain('Readable article text for the reader.')
    const missed = textOf(await run('live-app', 'wait', { seconds: 0.3, text: 'Never there' }))
    expect(missed).toMatch(/Waited up to 0.3 s for "Never there" to show, and it did not happen/)

    const snapshot = textOf(await run('live-app', 'snapshot'))
    const heading = refOf(snapshot, /heading "App" \[level=1\] \[ref=(e\d+)\]/)
    const shot = await run('live-app', 'take_screenshot', { ref: heading })
    expect(shot.some((part) => part.type === 'image')).toBe(true)

    const pdf = textOf(await run('live-app', 'pdf'))
    const pdfPath = /saved .*at (\S+\.pdf)\./i.exec(pdf)?.[1] ?? ''
    expect(pdfPath.startsWith(join(paths.agentDir('live-app'), 'uploads', 'browser'))).toBe(true)
    expect(readFileSync(pdfPath).subarray(0, 4).toString()).toBe('%PDF')

    const link = refOf(textOf(await run('live-app', 'snapshot')), /link "Report" \[ref=(e\d+)\]/)
    // The click's own result names the download when it is quick; a wait names it otherwise.
    let said = textOf(await run('live-app', 'click', { ref: link }))
    if (!said.includes('Downloaded report.csv'))
      said = textOf(await run('live-app', 'wait', { seconds: 10, download: true }))
    const saved = /Downloaded report\.csv: saved at (\S+)/.exec(said)?.[1] ?? ''
    expect(saved.startsWith(join(paths.agentDir('live-app'), 'uploads', 'browser'))).toBe(true)
    expect(readFileSync(saved, 'utf8')).toBe('a,b\n1,2\n')
  },
  120_000,
)

live(
  'emulation shows a tab as a phone, dark, in another locale and time zone, and resets',
  async () => {
    await run('live-media', 'navigate', { url: `${origin}/media` })
    const said = textOf(
      await run('live-media', 'emulate', {
        device: 'iPhone 15',
        color_scheme: 'dark',
        locale: 'it-IT',
        timezone: 'Europe/Rome',
      }),
    )
    expect(said).toContain('iPhone 15, 393×659')
    await run('live-media', 'navigate', { url: `${origin}/media` })
    expect(textOf(await run('live-media', 'text'))).toContain('dark|393|it-IT|Europe/Rome')
    await run('live-media', 'emulate', { reset: true })
    await run('live-media', 'navigate', { url: `${origin}/media` })
    expect(textOf(await run('live-media', 'text'))).not.toContain('dark|393|it-IT')
    await expect(run('live-media', 'emulate', { device: 'Nokia 3310' })).rejects.toThrow(
      /Unknown device/,
    )
  },
  120_000,
)

live(
  'a fresh browser on about:blank points the model at browser_navigate',
  async () => {
    for (const action of ['snapshot', 'take_screenshot']) {
      const result = await run('live-blank', action)
      expect(result.every((part) => part.type === 'text')).toBe(true)
      expect(textOf(result)).toMatch(/about:blank.*browser_navigate/)
    }
  },
  120_000,
)

live(
  'refs act on a page that keeps changing, and a missing ref fails at once',
  async () => {
    const page = textOf(await run('live-a', 'navigate', { url: `${origin}/ticker` }))
    const typed = textOf(
      await run('live-a', 'type', {
        ref: refOf(page, /textbox "Query" \[ref=(e\d+)\]/),
        text: 'purr',
      }),
    )
    expect(typed).toMatch(/textbox "Query"[^\n]*: purr/)
    const clicked = textOf(
      await run('live-a', 'click', { ref: refOf(typed, /button "Press" \[ref=(e\d+)\]/) }),
    )
    expect(clicked).toContain('clicked')

    const started = Date.now()
    const missing = textOf(await run('live-a', 'click', { ref: 'e99999' }))
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(missing).toMatch(/Ref "e99999" is not on the page any more, so nothing was done/)
    expect(missing).toContain('- Page URL:')
    await expect(run('live-a', 'click', { ref: 'e1 >> css=body' })).rejects.toThrow(/element ref/)
  },
  120_000,
)

live(
  'a long snapshot is read page by page',
  async () => {
    const first = textOf(await run('live-a', 'navigate', { url: `${origin}/long` }))
    const total = Number(/page 1 of (\d+)/.exec(first)?.[1])
    expect(total).toBeGreaterThan(1)
    expect(first).toContain('browser_snapshot {"page": 2}')
    const last = textOf(await run('live-a', 'snapshot', { page: total }))
    expect(last).toContain(`page ${total} of ${total}`)
    expect(last).toContain('paragraph number 1499')
    await expect(run('live-a', 'snapshot', { page: total + 1 })).rejects.toThrow(/between 1 and/)
  },
  120_000,
)

live(
  'tabs open, list, switch and close by id',
  async () => {
    await run('live-a', 'navigate', { url: `${origin}/hello` })
    const opened = textOf(await run('live-a', 'tabs', { op: 'new', url: `${origin}/ticker` }))
    expect(opened).toContain('/ticker')
    const listed = textOf(await run('live-a', 'tabs', { op: 'list' }))
    expect(listed).toMatch(/^ {2}tab-1 .*\/hello$/m)
    expect(listed).toMatch(/^\* tab-2 .*\/ticker$/m)
    expect(textOf(await run('live-a', 'tabs', { op: 'select', tabId: 'tab-1' }))).toContain(
      'Hello Bazilion',
    )
    expect(textOf(await run('live-a', 'tabs', { op: 'close', tabId: 'tab-2' }))).toBe(
      'Closed tab-2.',
    )
    expect(textOf(await run('live-a', 'tabs', { op: 'list' }))).not.toContain('tab-2')
  },
  120_000,
)

live(
  'cookies survive a browser restart; stop keeps the profile and ends the processes',
  async () => {
    await run('live-b', 'navigate', { url: `${origin}/set-cookie` })
    await closeBrowserSession('live-b')
    expect(resources().browsers.has('live-b')).toBe(false)
    expect(existsSync(paths.browserDir('live-b'))).toBe(true)
    await vi.waitFor(() => expect(processesOf('live-b')).toEqual([]), { timeout: 5_000 })

    const shown = textOf(await run('live-b', 'navigate', { url: `${origin}/show-cookie` }))
    expect(shown).toContain('cookie: baziu=purr')
  },
  120_000,
)

live(
  'a crashed browser reads as stopped, leaves no process behind and is not signalled again',
  async () => {
    await run('live-d', 'navigate', { url: `${origin}/hello` })
    const session = resources().browsers.get('live-d')
    const lock = readlinkSync(join(paths.browserDir('live-d'), 'user-data', 'SingletonLock'))
    process.kill(Number(/-(\d+)$/.exec(lock)?.[1]), 'SIGKILL')
    await vi.waitFor(() => expect(session?.browser.running).toBe(false), { timeout: 5_000 })
    expect(browserStatus('live-d', CONFIG, paths, true).running).toBe(false)
    await vi.waitFor(() => expect(processesOf('live-d')).toEqual([]), { timeout: 5_000 })
    // Its process group went with it; closing the dead session signals no group.
    const kill = vi.spyOn(process, 'kill')
    try {
      await closeBrowserSession('live-d')
      expect(kill.mock.calls.filter(([target]) => target < 0)).toEqual([])
    } finally {
      kill.mockRestore()
    }
  },
  120_000,
)

live(
  'a browser left behind by a dead daemon is replaced; reset deletes the profile',
  async () => {
    await run('live-c', 'navigate', { url: `${origin}/hello` })
    // Forget the session without closing it, as a crashed daemon would.
    const orphan = resources().browsers.get('live-c')
    resources().browsers.delete('live-c')
    expect(textOf(await run('live-c', 'navigate', { url: `${origin}/hello` }))).toContain(
      'Hello Bazilion',
    )
    await vi.waitFor(() => expect(orphan?.browser.running).toBe(false), { timeout: 5_000 })

    await removeBrowserProfile('live-c', paths)
    expect(existsSync(paths.browserDir('live-c'))).toBe(false)
    await vi.waitFor(() => expect(processesOf('live-c')).toEqual([]), { timeout: 5_000 })
  },
  120_000,
)

// Every destination is a loopback fixture; under the SSRF proxy it must see no request.
describe.skipIf(!available)('launch controls', () => {
  let scratch = ''
  const executablePath = available ? findBrowserExecutable().path : ''
  let origin: InstrumentedOrigin
  let proxyUrl: string
  const open: AgentBrowser[] = []

  async function launch(name: string, withProxy: boolean): Promise<AgentBrowser> {
    const browser = await launchBrowser({
      executablePath,
      dir: join(scratch, name),
      headless: true,
      ...(withProxy ? { proxyUrl } : {}),
    })
    open.push(browser)
    return browser
  }

  async function closed(browser: AgentBrowser, name: string): Promise<void> {
    await browser.close()
    await vi.waitFor(() => expect(browserProcesses(join(scratch, name, 'user-data'))).toEqual([]), {
      timeout: 8_000,
    })
  }

  const pageOf = async (context: BrowserContext): Promise<Page> =>
    context.pages()[0] ?? (await context.newPage())

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'baz-browser-managed-'))
    origin = await createInstrumentedOrigin()
    proxyUrl = await getSsrfProxy()
  })

  afterAll(async () => {
    await Promise.all(open.map((browser) => browser.close()))
    await origin?.close()
    await closeSsrfProxy()
    rmSync(scratch, { recursive: true, force: true })
  })

  test('behind the proxy, loopback fetch, iframe, WebSocket and popup reach nothing', {
    timeout: 60_000,
  }, async () => {
    const browser = await launch('proxied', true)
    const page = await pageOf(browser.context)
    await page.evaluate(`(async () => {
      const origin = ${JSON.stringify(origin.origin)}
      await fetch(origin + '/probe', { mode: 'no-cors' }).catch(() => {})
      const frame = document.createElement('iframe')
      frame.src = origin + '/probe'
      document.body.appendChild(frame)
      await new Promise((resolve) => {
        const ws = new WebSocket('ws://' + new URL(origin).host + '/probe')
        ws.onopen = ws.onerror = resolve
        setTimeout(resolve, 3000)
      })
    })()`)
    // A click-triggered popup, so the popup blocker is not what stops it.
    await page.setContent(`<button onclick="window.open('${origin.origin}/probe')">open</button>`)
    await page.click('button')
    await expect.poll(() => browser.context.pages().length).toBe(2)
    await page.waitForTimeout(1_000)
    expect(origin.hits).toEqual([])
  })

  test('pages and frames have no WebRTC', { timeout: 60_000 }, async () => {
    const browser = open[0] ?? (await launch('proxied', true))
    const page = await pageOf(browser.context)
    await page.setContent('<iframe srcdoc="<p>frame</p>"></iframe>')
    await expect.poll(() => page.frames().length).toBe(2)
    for (const frame of page.frames()) {
      expect(
        await frame.evaluate(
          `[typeof RTCPeerConnection, typeof webkitRTCPeerConnection, typeof mozRTCPeerConnection]`,
        ),
      ).toEqual(['undefined', 'undefined', 'undefined'])
    }
    await closed(browser, 'proxied')
  })

  test("a download reaches the daemon, never the browser's own Downloads folder", {
    timeout: 60_000,
  }, async () => {
    const browser = await launch('downloads', false)
    const page = await pageOf(browser.context)
    await page.goto(`${origin.origin}/download-page`)
    const download = page.waitForEvent('download')
    await page.click('#dl')
    // The pool saves it with the Agent's uploads (see its own test above).
    expect(await (await download).failure()).toBeNull()
    const saved = join(scratch, 'downloads', 'home', 'Downloads')
    expect(existsSync(saved) ? readdirSync(saved) : []).toEqual([])
    await closed(browser, 'downloads')
  })

  test("cookies and a service worker survive a restart; the worker's own requests stay behind the proxy", {
    timeout: 120_000,
  }, async () => {
    const first = await launch('persistent', false)
    const page = await pageOf(first.context)
    await page.goto(`${origin.origin}/sw-page`)
    // The browser stores a worker once it is installed: one closed before that is lost. The page
    // reports the worker's state in its title, which this waits for. (waitForFunction takes a
    // returned promise as "true" at once, so it cannot wait on getRegistrations() itself.)
    await page.waitForFunction('/^SW-(ACTIVATED|REJECTED)/.test(document.title)')
    expect(await page.title()).toBe('SW-ACTIVATED')
    await first.context.addCookies([
      {
        name: 'baziu',
        value: 'purr',
        url: origin.origin,
        expires: Math.floor(Date.now() / 1000) + 3_600,
      },
    ])
    await closed(first, 'persistent')

    origin.hits.length = 0
    const second = await launch('persistent', true)
    expect((await second.context.cookies()).some((c) => c.name === 'baziu')).toBe(true)
    const again = await pageOf(second.context)
    await again.goto(`${origin.origin}/sw-scope/check`)
    const text = await again.locator('body').innerText()
    expect(text).toContain('persisted-worker-active')
    expect(text).toMatch(/network-(blocked|status:403)/)
    expect(origin.hits).toEqual([])
    await closed(second, 'persistent')
  })
})
