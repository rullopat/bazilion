// One persistent browser per agent (or, with BROWSER_ATTACH, one set of tabs per agent in a
// browser that is already running), held in the daemon's resource registry so
// cookies, logins and open tabs survive across turns. The worker's `browser_*`
// tools reach it over IPC (`host.ts`); every call runs here, one at a time per
// agent. A browser quits when idle for BROWSER_IDLE_MS, when the pool needs room
// (least recently used idle browser first), when the browser settings change, when
// a call hangs or its turn is cancelled mid-call, on operator stop or reset, and at
// daemon shutdown. Its profile stays on disk until a reset or the agent's deletion.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BrowserStatus } from '@bazilion/api-types'
import {
  type Request as BrowserRequest,
  type Response as BrowserResponse,
  type CDPSession,
  type ConsoleMessage,
  type Download,
  devices,
  type Page,
  type WebError,
} from 'playwright'
import type { Paths } from '../../core/index.ts'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import { extractReadable } from '../../runtime/tools/web-extract.ts'
import { ensureResourceReaper, resources } from '../resources.ts'
import { attachBrowser } from './attach.ts'
import type { BrowserConfig } from './config.ts'
import { findBrowserExecutable } from './executable.ts'
import { browserDownloadNote, ensureBrowserExecutable } from './install.ts'
import { type AgentBrowser, killOrphanBrowser, launchBrowser } from './launch.ts'
import { getSsrfProxy } from './proxy.ts'
import { capText, clip, formatSnapshot, type Snapshot, splitPages } from './snapshot.ts'
import { browserBlockReason } from './ssrf.ts'

const LOG_CAP = 100
/** The longest console message kept. */
const CONSOLE_CHARS = 2_000
const MAX_TABS = 8
/** A call taking longer means the page hangs; the browser is then stopped. */
const CALL_TIMEOUT_MS = 120_000
/** A larger PNG is refused instead of being sent to the model. */
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
const NO_PAGE_HINT =
  'No page is loaded yet (the tab is about:blank). Call browser_navigate with a URL first.'

export interface BrowserSession {
  agentId: string
  /** The settings the browser was launched with; a change relaunches it. */
  key: string
  browser: AgentBrowser
  lastUsedAt: number
  idleMs: number
  /** Actions in flight: the idle reaper and pool eviction leave a busy browser alone. */
  busy: number
  tabIds: WeakMap<Page, string>
  tabCount: number
  activeTab: string | null
  /** The latest snapshot, kept so the model can read the rest of it page by page. */
  snapshot: Snapshot | null
  console: string[]
  network: Array<{ method: string; url: string; status?: number; failure?: string }>
  /** Console errors and warnings and uncaught page errors since `browser_errors` last read them. */
  errors: string[]
  /** Files pages downloaded (an Agent's own browser only), until a result has named them. */
  downloads: Array<{
    name: string
    path: string
    state: 'saving' | 'saved' | 'failed'
    error?: string
  }>
  /** The DevTools sessions that hold a tab's emulation (`browser_emulate`). */
  emulation: WeakMap<Page, CDPSession>
  /** Remove the session from the pool and quit its browser. Never throws. */
  close(): Promise<void>
}

// One browser call (or launch, stop, reset) at a time per agent.
const queues = new Map<string, Promise<unknown>>()
// Browsers still quitting: a relaunch on the same profile waits for them.
const closing = new Map<string, Promise<void>>()
// The last failed launch per agent, reported by the browser status.
const launchErrors = new Map<string, string>()
let launching = 0

function serialize<T>(agentId: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(agentId) ?? Promise.resolve()).then(work)
  const settled = run.then(
    () => {},
    () => {},
  )
  queues.set(agentId, settled)
  void settled.then(() => {
    if (queues.get(agentId) === settled) queues.delete(agentId)
  })
  return run
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function configKey(config: BrowserConfig): string {
  return config.attach
    ? `attach|${config.attachUrl ?? ''}|${config.allowPrivate}`
    : `${config.headless}|${config.executablePath ?? ''}|${config.allowPrivate}`
}

/** The page a request came from; a service worker's request has none. */
function requestPage(request: BrowserRequest): Page | null {
  try {
    return request.frame().page()
  } catch {
    return null
  }
}

function tabId(session: BrowserSession, page: Page): string {
  let id = session.tabIds.get(page)
  if (!id) {
    id = `tab-${++session.tabCount}`
    session.tabIds.set(page, id)
  }
  return id
}

function remember<T>(log: T[], entry: T): void {
  log.push(entry)
  if (log.length > LOG_CAP) log.shift()
}

function startSession(
  agentId: string,
  key: string,
  browser: AgentBrowser,
  idleMs: number,
  /** Where downloads are saved; null in an attached browser, where they are refused. */
  downloadsDir: string | null,
): BrowserSession {
  const sessions = resources().browsers
  const { context } = browser
  // An attached browser outlives the session: its listeners are taken off again.
  const unlisten: Array<() => void> = []
  let closed: Promise<void> | undefined
  const session: BrowserSession = {
    agentId,
    key,
    browser,
    lastUsedAt: Date.now(),
    idleMs,
    busy: 0,
    tabIds: new WeakMap(),
    tabCount: 0,
    activeTab: null,
    snapshot: null,
    console: [],
    network: [],
    errors: [],
    downloads: [],
    emulation: new WeakMap(),
    close() {
      if (sessions.get(agentId) === session) sessions.delete(agentId)
      if (!closed) {
        for (const off of unlisten) off()
        const done = browser.close()
        closed = done
        closing.set(agentId, done)
        void done.then(() => {
          if (closing.get(agentId) === done) closing.delete(agentId)
        })
      }
      return closed
    },
  }
  // A download is saved with the Agent's uploads, and the next result names it.
  const onDownload = (download: Download) => {
    if (!downloadsDir) return
    const name = basename(download.suggestedFilename()) || 'download'
    const path = join(downloadsDir, `${Date.now()}-${name.replace(/[^\w.-]+/g, '_')}`)
    const entry: BrowserSession['downloads'][number] = { name, path, state: 'saving' }
    remember(session.downloads, entry)
    mkdirSync(downloadsDir, { recursive: true })
    download.saveAs(path).then(
      () => {
        entry.state = 'saved'
      },
      (error: unknown) => {
        entry.state = 'failed'
        entry.error = clip(errorMessage(error))
      },
    )
  }
  const watch = (page: Page) => {
    tabId(session, page)
    page.on('download', onDownload)
    unlisten.push(() => page.off('download', onDownload))
  }
  for (const page of browser.pages()) watch(page)
  // Popups and tabs a page opens get tab ids too (in an attached browser, when first listed).
  const onPage = (page: Page) => {
    if (browser.owns(page)) watch(page)
  }
  // Page-controlled text is clipped as it is kept, so the logs stay small. In an attached
  // browser only the agent's own tabs are logged.
  const onConsole = (message: ConsoleMessage) => {
    if (!browser.owns(message.page())) return
    const line = clip(`[${message.type()}] ${message.text()}`, CONSOLE_CHARS)
    remember(session.console, line)
    if (message.type() === 'error' || message.type() === 'warning') remember(session.errors, line)
  }
  const onWebError = (error: WebError) => {
    if (!browser.owns(error.page())) return
    remember(session.errors, clip(`[uncaught] ${error.error().message}`, CONSOLE_CHARS))
  }
  const entries = new WeakMap<BrowserRequest, BrowserSession['network'][number]>()
  const onRequest = (request: BrowserRequest) => {
    if (!browser.owns(requestPage(request))) return
    const entry = { method: request.method(), url: clip(request.url()) }
    entries.set(request, entry)
    remember(session.network, entry)
  }
  const onResponse = (response: BrowserResponse) => {
    const entry = entries.get(response.request())
    if (entry) entry.status = response.status()
  }
  const onFailed = (request: BrowserRequest) => {
    const entry = entries.get(request)
    if (entry) entry.failure = clip(request.failure()?.errorText ?? 'failed')
  }
  context.on('page', onPage)
  context.on('console', onConsole)
  context.on('weberror', onWebError)
  context.on('request', onRequest)
  context.on('response', onResponse)
  context.on('requestfailed', onFailed)
  unlisten.push(
    () => context.off('page', onPage),
    () => context.off('console', onConsole),
    () => context.off('weberror', onWebError),
    () => context.off('request', onRequest),
    () => context.off('response', onResponse),
    () => context.off('requestfailed', onFailed),
  )
  sessions.set(agentId, session)
  ensureResourceReaper()
  return session
}

/** The agent's running browser, launched on first use, marked busy for the caller. */
async function claimSession(
  agentId: string,
  config: BrowserConfig,
  paths: Paths,
): Promise<BrowserSession> {
  const sessions = resources().browsers
  const key = configKey(config)
  const existing = sessions.get(agentId)
  if (existing && existing.key === key && existing.browser.running) {
    existing.idleMs = config.idleMs // a new BROWSER_IDLE_MS needs no restart
    existing.busy++
    return existing
  }
  // Changed settings or a browser that died: start again on the same profile.
  if (existing) await existing.close()
  await closing.get(agentId)
  while (sessions.size + launching >= config.maxSessions) {
    const idle = [...sessions.values()]
      .filter((session) => session.busy === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
    if (!idle) {
      throw new Error(
        `All ${config.maxSessions} browser sessions are in use (BROWSER_MAX_SESSIONS); try again shortly.`,
      )
    }
    await idle.close()
  }
  launching++
  try {
    const browser = config.attach
      ? await attachBrowser({
          allowPrivate: config.allowPrivate,
          ...(config.attachUrl ? { url: config.attachUrl } : {}),
        })
      : await launchBrowser({
          executablePath: (await ensureBrowserExecutable(config.executablePath)).path,
          dir: paths.browserDir(agentId),
          headless: config.headless,
          ...(config.allowPrivate ? {} : { proxyUrl: await getSsrfProxy() }),
        })
    launchErrors.delete(agentId)
    const session = startSession(
      agentId,
      key,
      browser,
      config.idleMs,
      config.attach ? null : join(paths.agentDir(agentId), 'uploads', 'browser'),
    )
    session.busy++
    return session
  } catch (error) {
    launchErrors.set(agentId, errorMessage(error))
    throw error
  } finally {
    launching--
  }
}

/** Run one `browser_*` action for an agent; `signal` is the turn's cancellation. */
export async function invokeBrowserAction(
  agentId: string,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
  paths: Paths,
  signal?: AbortSignal,
  /** How the turn's Agent sees its uploads folder (`/inputs` in Docker), for saved files. */
  uploadsShown?: string,
): Promise<ToolResultPart[]> {
  const uploads = join(paths.agentDir(agentId), 'uploads')
  const shown = (path: string) =>
    uploadsShown && path.startsWith(uploads) ? `${uploadsShown}${path.slice(uploads.length)}` : path
  try {
    return await serialize(agentId, async () => {
      signal?.throwIfAborted()
      const session = await claimSession(agentId, config, paths)
      let timer: NodeJS.Timeout | undefined
      let onAbort: (() => void) | undefined
      try {
        signal?.throwIfAborted()
        // A hung page, or a turn cancelled mid-call, stops the browser so the
        // agent's next call does not wait behind this one; that call starts it again.
        const stopped = new Promise<never>((_, reject) => {
          const stop = (reason: unknown) => {
            void session.close()
            reject(reason)
          }
          // browser_wait waits as long as it was asked to, on top of the usual allowance.
          const waiting = action === 'wait' ? waitSeconds(args) * 1000 : 0
          timer = setTimeout(
            () => stop(new Error('the browser did not answer in time and was stopped; try again')),
            CALL_TIMEOUT_MS + waiting,
          )
          onAbort = () => stop(signal?.reason)
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        const result = await Promise.race([
          runAction(session, action, args, config, { dir: uploads, shown }),
          stopped,
        ])
        return withDownloads(session, result, shown)
      } finally {
        clearTimeout(timer)
        if (onAbort) signal?.removeEventListener('abort', onAbort)
        session.busy--
        session.lastUsedAt = Date.now()
      }
    })
  } catch (error) {
    // Error text can quote page-controlled URLs: it is capped like any result.
    throw new Error(capText(errorMessage(error)))
  }
}

/** Quit an agent's browser right away (a call in flight fails); the profile stays on disk. */
export async function closeBrowserSession(agentId: string): Promise<void> {
  await resources().browsers.get(agentId)?.close()
}

/** Quit an agent's browser and delete its profile: cookies, logins, history. */
export async function removeBrowserProfile(agentId: string, paths: Paths): Promise<void> {
  await closeBrowserSession(agentId)
  // Calls already queued for the agent run first; the profile goes once they are done.
  await serialize(agentId, async () => {
    await closeBrowserSession(agentId)
    await closing.get(agentId)
    const dir = paths.browserDir(agentId)
    // A browser a dead daemon left on the profile would outlive it: kill it first.
    await killOrphanBrowser(dir)
    rmSync(dir, { recursive: true, force: true })
    launchErrors.delete(agentId)
  })
}

/** Quit browsers idle past their timeout; called by the resource reaper. */
export function reapIdleBrowserSessions(now = Date.now()): void {
  for (const session of resources().browsers.values()) {
    if (session.busy === 0 && session.lastUsedAt + session.idleMs <= now) void session.close()
  }
}

/** What the operator sees under Browser in the web workspace and in `agent browser status`. Never launches. */
export function browserStatus(
  agentId: string,
  config: BrowserConfig,
  paths: Paths,
  enabled: boolean,
): BrowserStatus {
  const status: BrowserStatus = {
    agentId,
    enabled,
    // A browser that crashed or whose window was closed stays registered until
    // its next call or the reaper, but is not running.
    running: resources().browsers.get(agentId)?.browser.running ?? false,
    profilePresent: existsSync(paths.browserDir(agentId)),
  }
  const launchError = launchErrors.get(agentId)
  if (config.attach) {
    status.browser = {
      name: config.attachUrl ?? 'The running Chrome or Chromium',
      mode: 'attached',
    }
    if (launchError) status.error = launchError
    return status
  }
  try {
    const { name } = findBrowserExecutable(config.executablePath)
    status.browser = { name, mode: config.headless ? 'headless' : 'headed' }
    if (launchError) status.error = launchError
  } catch (error) {
    // No browser on this machine: say whether Chromium is on its way.
    status.error =
      (config.executablePath ? null : browserDownloadNote()) ?? launchError ?? errorMessage(error)
  }
  return status
}

// --- actions ---

/** A text result; every one is capped, whatever the page put into it. */
function text(value: string): ToolResultPart[] {
  return [{ type: 'text', text: capText(value) }]
}

/** The first line of an error, clipped: Playwright messages can quote page-controlled URLs. */
function firstLine(error: unknown): string {
  return clip(errorMessage(error).split('\n')[0] ?? '')
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`"${key}" must be a non-empty string`)
  return value
}

/** Refs go into an `aria-ref=` selector, so only the snapshot's own format is accepted. */
function elementRef(value: unknown): string {
  if (typeof value !== 'string' || !/^(f\d+)?e\d+$/.test(value)) {
    throw new Error('ref must be an element ref from the latest browser_snapshot, like "e5"')
  }
  return value
}

function isBlank(page: Page): boolean {
  return !page.url() || page.url() === 'about:blank'
}

async function checkUrl(url: string, config: BrowserConfig): Promise<void> {
  const reason = await browserBlockReason(url, config.allowPrivate)
  if (reason) throw new Error(`navigation blocked: ${reason}`)
}

/** The active tab, else the first open one, else a new one. */
async function activePage(session: BrowserSession): Promise<Page> {
  const pages = session.browser.pages()
  const page =
    pages.find((p) => tabId(session, p) === session.activeTab) ??
    pages[0] ??
    (await session.browser.newPage())
  session.activeTab = tabId(session, page)
  return page
}

async function snapshot(session: BrowserSession, page: Page, ref?: string): Promise<string> {
  const tree = await page
    .locator(ref ? `aria-ref=${ref}` : 'body')
    .ariaSnapshot({ mode: 'ai', timeout: 5_000 })
  session.snapshot = {
    tabId: tabId(session, page),
    url: page.url(),
    title: await page.title(),
    pages: splitPages(tree),
  }
  return formatSnapshot(session.snapshot)
}

/** A snapshot after an action; a failure becomes a hint instead of hiding the action's result. */
async function freshSnapshot(session: BrowserSession, page: Page): Promise<string> {
  try {
    return await snapshot(session, page)
  } catch (error) {
    return `No fresh snapshot is available (${firstLine(error)}). Call browser_snapshot, or browser_tabs {"op":"list"} to see where you are.`
  }
}

function snapshotPage(session: BrowserSession, value: unknown): string {
  const latest = session.snapshot
  if (!latest) throw new Error('There is no snapshot to page through; call browser_snapshot first.')
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > latest.pages.length) {
    throw new Error(`page must be between 1 and ${latest.pages.length}`)
  }
  return formatSnapshot(latest, n)
}

/** Run a ref action and answer with a fresh snapshot, also when the action failed. */
async function act(
  session: BrowserSession,
  refs: string[],
  action: (page: Page) => Promise<unknown>,
): Promise<ToolResultPart[]> {
  const page = await activePage(session)
  // A ref missing from the page would only time out: say so at once.
  for (const ref of refs) {
    if ((await page.locator(`aria-ref=${ref}`).count()) === 0) {
      return text(
        `Ref "${ref}" is not on the page any more, so nothing was done. Use a ref from this fresh snapshot:\n\n${await freshSnapshot(session, page)}`,
      )
    }
  }
  try {
    await action(page)
  } catch (error) {
    return text(
      `Could not act on ref "${refs.join(', ')}": ${firstLine(error)}\n` +
        'The action may still have taken effect: check the page below before trying again, and never repeat a submission blindly.\n\n' +
        (await freshSnapshot(session, page)),
    )
  }
  return text(await freshSnapshot(session, page))
}

/** How long `browser_wait` may wait, as the Agent asked. */
function waitSeconds(args: Record<string, unknown>): number {
  const seconds = Number(args.seconds)
  if (!(seconds > 0))
    throw new Error('"seconds" must be a number above 0: how long to wait at most')
  return seconds
}

/** The result, with what pages downloaded since the last result. */
function withDownloads(
  session: BrowserSession,
  result: ToolResultPart[],
  shown: (path: string) => string,
): ToolResultPart[] {
  if (session.downloads.length === 0) return result
  const saving = session.downloads.filter((entry) => entry.state === 'saving')
  const lines = session.downloads.map((entry) =>
    entry.state === 'saved'
      ? `Downloaded ${clip(entry.name)}: saved at ${shown(entry.path)}`
      : entry.state === 'failed'
        ? `The download of ${clip(entry.name)} failed: ${entry.error ?? 'unknown error'}`
        : `Still downloading ${clip(entry.name)}; browser_wait with download: true waits for it.`,
  )
  session.downloads = saving
  return [...result, { type: 'text', text: lines.join('\n') }]
}

/** A file name from a page's address. */
function pageName(url: string): string {
  let name = 'page'
  try {
    const parsed = new URL(url)
    name = `${parsed.hostname}${parsed.pathname}`
  } catch {}
  return (
    name
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  )
}

const COLOR_SCHEMES = ['light', 'dark', 'no-preference'] as const

/** Device size and touch, colour scheme, locale and time zone of one tab, over DevTools. */
async function emulate(session: BrowserSession, page: Page, args: Record<string, unknown>) {
  let cdp = session.emulation.get(page)
  if (!cdp) {
    cdp = await page.context().newCDPSession(page)
    session.emulation.set(page, cdp)
  }
  if (args.reset === true) {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: '' })
    await cdp.send('Emulation.setLocaleOverride', {})
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' })
    await page.emulateMedia({ colorScheme: null })
    return 'Back to the browser’s own size, scheme, locale and time zone.'
  }
  const said: string[] = []
  const name = typeof args.device === 'string' ? args.device : undefined
  const device = name ? devices[name] : undefined
  if (name && !device) {
    const known = Object.keys(devices).filter((key) => !key.endsWith('landscape'))
    throw new Error(
      `Unknown device "${clip(name)}". Some there are: ${known.slice(0, 12).join(', ')}.`,
    )
  }
  const width = typeof args.width === 'number' ? args.width : device?.viewport.width
  const height = typeof args.height === 'number' ? args.height : device?.viewport.height
  if (width && height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width),
      height: Math.round(height),
      deviceScaleFactor: device?.deviceScaleFactor ?? 0,
      mobile: device?.isMobile ?? false,
    })
    said.push(`${name ? `${name}, ` : ''}${Math.round(width)}×${Math.round(height)}`)
  }
  const touch = typeof args.touch === 'boolean' ? args.touch : device?.hasTouch
  if (touch !== undefined) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch })
    said.push(touch ? 'touch' : 'no touch')
  }
  const locale = typeof args.locale === 'string' && args.locale ? args.locale : undefined
  // The user agent carries the language pages read from navigator.language and Accept-Language.
  if (device?.userAgent || locale) {
    const userAgent = device?.userAgent ?? (await cdp.send('Browser.getVersion')).userAgent
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent,
      ...(locale ? { acceptLanguage: locale } : {}),
    })
  }
  if (args.color_scheme !== undefined) {
    const scheme = COLOR_SCHEMES.find((value) => value === args.color_scheme)
    if (!scheme) throw new Error('color_scheme must be light, dark or no-preference')
    await page.emulateMedia({ colorScheme: scheme })
    said.push(`${scheme} colour scheme`)
  }
  if (locale) {
    await cdp.send('Emulation.setLocaleOverride', { locale })
    said.push(`locale ${clip(locale)}`)
  }
  if (typeof args.timezone === 'string' && args.timezone) {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: args.timezone })
    said.push(`time zone ${clip(args.timezone)}`)
  }
  if (said.length === 0)
    throw new Error(
      'Say what to emulate: device, width and height, touch, color_scheme, locale or timezone, or reset: true.',
    )
  return `This tab now has: ${said.join(', ')}. It lasts until you reset it or the tab closes; reload the page if it read these when it loaded.`
}

async function runAction(
  session: BrowserSession,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
  files: { dir: string; shown: (path: string) => string },
): Promise<ToolResultPart[]> {
  switch (action) {
    case 'errors': {
      const errors = session.errors.splice(0)
      return text(
        errors.length > 0
          ? errors.join('\n')
          : 'No console errors or warnings, and no uncaught page errors, since you last looked.',
      )
    }
    case 'text': {
      const page = await activePage(session)
      if (isBlank(page)) return text(NO_PAGE_HINT)
      if (args.ref !== undefined) {
        const ref = elementRef(args.ref)
        return text(await page.locator(`aria-ref=${ref}`).innerText({ timeout: 5_000 }))
      }
      const read = extractReadable(await page.content(), page.url(), 'markdown')
      return text(read.title ? `# ${read.title}\n\n${read.text}` : read.text)
    }
    case 'wait': {
      const page = await activePage(session)
      const timeout = waitSeconds(args) * 1000
      const goals: Array<[string, () => Promise<unknown>]> = []
      if (typeof args.text === 'string' && args.text) {
        const wanted = args.text
        goals.push([
          `"${clip(wanted)}" to show`,
          () => page.getByText(wanted).first().waitFor({ timeout }),
        ])
      }
      if (args.ref !== undefined) {
        const ref = elementRef(args.ref)
        goals.push([`${ref} to show`, () => page.locator(`aria-ref=${ref}`).waitFor({ timeout })])
      }
      if (typeof args.url === 'string' && args.url) {
        const wanted = args.url
        goals.push([
          `an address with "${clip(wanted)}"`,
          () => page.waitForURL((url) => url.href.includes(wanted), { timeout }),
        ])
      }
      if (args.settled === true) {
        goals.push(['the page to settle', () => page.waitForLoadState('networkidle', { timeout })])
      }
      if (args.download === true) {
        goals.push([
          'its downloads to finish',
          // One that has not started yet is waited for too.
          async () => {
            const end = Date.now() + timeout
            const busy = () =>
              session.downloads.length === 0 ||
              session.downloads.some((entry) => entry.state === 'saving')
            while (busy() && Date.now() < end) {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
            if (session.downloads.length === 0) throw new Error('no download started')
            if (busy()) throw new Error('still downloading')
          },
        ])
      }
      if (goals.length === 0)
        throw new Error('Say what to wait for: text, ref, url, settled or download.')
      for (const [goal, wait] of goals) {
        try {
          await wait()
        } catch (error) {
          return text(
            `Waited up to ${timeout / 1000} s for ${goal}, and it did not happen (${firstLine(error)}).\n\n${await freshSnapshot(session, page)}`,
          )
        }
      }
      return text(
        `Done waiting for ${goals.map(([goal]) => goal).join(' and ')}.\n\n${await freshSnapshot(session, page)}`,
      )
    }
    case 'pdf': {
      const page = await activePage(session)
      if (isBlank(page)) return text(NO_PAGE_HINT)
      let pdf: Buffer
      try {
        pdf = await page.pdf({ printBackground: true })
      } catch (error) {
        throw new Error(
          `The page could not be saved as a PDF (${firstLine(error)}): that takes the Agent's own browser running headless, not a visible window or your running Chrome.`,
        )
      }
      const dir = join(files.dir, 'browser')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${pageName(page.url())}-${Date.now()}.pdf`)
      writeFileSync(path, pdf)
      return text(
        `Saved the page as a PDF (${Math.ceil(pdf.length / 1024)} KB) at ${files.shown(path)}.`,
      )
    }
    case 'emulate': {
      const page = await activePage(session)
      const said = await emulate(session, page, args)
      return text(isBlank(page) ? said : `${said}\n\n${await freshSnapshot(session, page)}`)
    }
    case 'navigate': {
      const url = stringArg(args, 'url')
      await checkUrl(url, config)
      const page = await activePage(session)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return text(await freshSnapshot(session, page))
    }
    case 'snapshot': {
      if (args.page !== undefined) return text(snapshotPage(session, args.page))
      const page = await activePage(session)
      if (isBlank(page)) return text(NO_PAGE_HINT)
      const ref = args.ref === undefined ? undefined : elementRef(args.ref)
      return text(await snapshot(session, page, ref))
    }
    case 'click': {
      const ref = elementRef(args.ref)
      return act(session, [ref], (page) => page.locator(`aria-ref=${ref}`).click())
    }
    case 'type': {
      const ref = elementRef(args.ref)
      const value = args.text
      if (typeof value !== 'string') throw new Error('"text" must be a string')
      return act(session, [ref], async (page) => {
        const field = page.locator(`aria-ref=${ref}`)
        await field.fill(value)
        if (args.submit === true) await field.press('Enter')
      })
    }
    case 'hover': {
      const ref = elementRef(args.ref)
      return act(session, [ref], (page) => page.locator(`aria-ref=${ref}`).hover())
    }
    case 'select': {
      const ref = elementRef(args.ref)
      if (!Array.isArray(args.values)) throw new Error('"values" must be a list of option values')
      const values = args.values.map(String)
      return act(session, [ref], (page) => page.locator(`aria-ref=${ref}`).selectOption(values))
    }
    case 'fill_form': {
      // Every field is checked before any is filled.
      const fields = (Array.isArray(args.fields) ? args.fields : []).map((field) => {
        const entry = (field ?? {}) as Record<string, unknown>
        const ref = elementRef(entry.ref)
        if (typeof entry.value !== 'string')
          throw new Error(`the value for ${ref} must be a string`)
        return { ref, value: entry.value }
      })
      if (fields.length === 0) throw new Error('fields must list at least one { ref, value }')
      return act(
        session,
        fields.map((field) => field.ref),
        async (page) => {
          for (const field of fields) await page.locator(`aria-ref=${field.ref}`).fill(field.value)
        },
      )
    }
    case 'press_key': {
      const key = stringArg(args, 'key')
      const page = await activePage(session)
      await page.keyboard.press(key)
      return text(await freshSnapshot(session, page))
    }
    case 'go_back': {
      const page = await activePage(session)
      await page.goBack({ waitUntil: 'domcontentloaded' })
      return text(await freshSnapshot(session, page))
    }
    case 'tabs':
      return tabs(session, args, config)
    case 'take_screenshot': {
      const page = await activePage(session)
      if (isBlank(page)) return text(NO_PAGE_HINT)
      const png =
        args.ref !== undefined
          ? await page
              .locator(`aria-ref=${elementRef(args.ref)}`)
              .screenshot({ type: 'png', scale: 'css', timeout: 5_000 })
          : await page.screenshot({
              type: 'png',
              fullPage: args.full_page === true,
              scale: 'css',
            })
      if (png.length > MAX_SCREENSHOT_BYTES) {
        throw new Error(
          `The screenshot is ${(png.length / 1024 / 1024).toFixed(1)} MB, over the 4 MB limit; take one of the visible area (without full_page).`,
        )
      }
      return [
        { type: 'text', text: `Screenshot of ${clip(page.url())}` },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ]
    }
    case 'console':
      return text(session.console.join('\n') || 'no console messages')
    case 'network': {
      const filter = typeof args.filter === 'string' ? args.filter.toLowerCase() : ''
      const rows = session.network.filter(
        (r) => !filter || r.url.toLowerCase().includes(filter) || r.method.toLowerCase() === filter,
      )
      return text(
        rows
          .map(
            (r) =>
              `${r.method} ${r.failure ? `failed: ${r.failure}` : (r.status ?? '...')} ${r.url}`,
          )
          .join('\n') || `No requests recorded${filter ? ' that match' : ''}.`,
      )
    }
    default:
      throw new Error(`unknown browser action: ${action}`)
  }
}

async function tabs(
  session: BrowserSession,
  args: Record<string, unknown>,
  config: BrowserConfig,
): Promise<ToolResultPart[]> {
  const op = stringArg(args, 'op')
  const { browser } = session
  if (op === 'list') {
    const lines = browser
      .pages()
      .map((page) => {
        const id = tabId(session, page)
        return `${id === session.activeTab ? '*' : ' '} ${id}  ${clip(page.url())}`
      })
      .join('\n')
    return text(lines || 'No tabs are open.')
  }
  if (op === 'new') {
    if (browser.pages().length >= MAX_TABS) {
      throw new Error(`${MAX_TABS} tabs are already open; close one first`)
    }
    const url = typeof args.url === 'string' && args.url ? args.url : undefined
    if (url) await checkUrl(url, config)
    const page = await browser.newPage()
    session.activeTab = tabId(session, page)
    if (!url) return text(`Opened ${session.activeTab} (about:blank).`)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return text(await freshSnapshot(session, page))
  }
  const id = stringArg(args, 'tabId')
  const page = browser.pages().find((p) => tabId(session, p) === id)
  if (op === 'select') {
    if (!page) throw new Error(`No open tab "${id}"; browser_tabs {"op":"list"} lists them.`)
    // Bring the tab to the front so the browser keeps rendering it.
    await page.bringToFront()
    session.activeTab = id
    return text(
      isBlank(page) ? `Selected ${id} (about:blank).` : await freshSnapshot(session, page),
    )
  }
  if (op === 'close') {
    if (!page) return text(`Tab "${id}" is not open.`)
    await page.close()
    return text(`Closed ${id}.`)
  }
  throw new Error(`unknown tabs op "${op}" (expected list, new, select or close)`)
}
