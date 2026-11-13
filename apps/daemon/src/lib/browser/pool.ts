// One persistent browser per agent, held in the daemon's resource registry so
// cookies, logins and open tabs survive across turns. The worker's `browser_*`
// tools reach it over IPC (`host.ts`); every call runs here, one at a time per
// agent. A browser quits when idle for BROWSER_IDLE_MS, when the pool needs room
// (least recently used idle browser first), when the browser settings change, when
// a call hangs or its turn is cancelled mid-call, on operator stop or reset, and at
// daemon shutdown. Its profile stays on disk until a reset or the agent's deletion.

import { existsSync, rmSync } from 'node:fs'
import type { BrowserStatus } from '@bazilion/api-types'
import type { Request as BrowserRequest, Page } from 'playwright'
import type { Paths } from '../../core/index.ts'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import { ensureResourceReaper, resources } from '../resources.ts'
import type { BrowserConfig } from './config.ts'
import { findBrowserExecutable } from './executable.ts'
import { killOrphanBrowser, type LaunchedBrowser, launchBrowser } from './launch.ts'
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
  browser: LaunchedBrowser
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
  network: Array<{ method: string; url: string; status?: number }>
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
  return `${config.headless}|${config.executablePath ?? ''}|${config.allowPrivate}`
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
  browser: LaunchedBrowser,
  idleMs: number,
): BrowserSession {
  const sessions = resources().browsers
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
    close() {
      if (sessions.get(agentId) === session) sessions.delete(agentId)
      if (!closed) {
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
  const { context } = browser
  for (const page of context.pages()) tabId(session, page)
  // Popups and tabs a page opens get tab ids too.
  context.on('page', (page) => {
    tabId(session, page)
  })
  // Page-controlled text is clipped as it is kept, so the logs stay small.
  context.on('console', (message) => {
    remember(session.console, clip(`[${message.type()}] ${message.text()}`, CONSOLE_CHARS))
  })
  const entries = new WeakMap<BrowserRequest, BrowserSession['network'][number]>()
  context.on('request', (request) => {
    const entry = { method: request.method(), url: clip(request.url()) }
    entries.set(request, entry)
    remember(session.network, entry)
  })
  context.on('response', (response) => {
    const entry = entries.get(response.request())
    if (entry) entry.status = response.status()
  })
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
    const executable = findBrowserExecutable(config.executablePath)
    const browser = await launchBrowser({
      executablePath: executable.path,
      dir: paths.browserDir(agentId),
      headless: config.headless,
      ...(config.allowPrivate ? {} : { proxyUrl: await getSsrfProxy() }),
    })
    launchErrors.delete(agentId)
    const session = startSession(agentId, key, browser, config.idleMs)
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
): Promise<ToolResultPart[]> {
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
          timer = setTimeout(
            () => stop(new Error('the browser did not answer in time and was stopped; try again')),
            CALL_TIMEOUT_MS,
          )
          onAbort = () => stop(signal?.reason)
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        return await Promise.race([runAction(session, action, args, config), stopped])
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

/** What the operator sees on the Agent page and in `agent browser status`. Never launches. */
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
  try {
    const { name } = findBrowserExecutable(config.executablePath)
    status.browser = { name, mode: config.headless ? 'headless' : 'headed' }
    const launchError = launchErrors.get(agentId)
    if (launchError) status.error = launchError
  } catch (error) {
    status.error = errorMessage(error)
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
  const pages = session.browser.context.pages()
  const page =
    pages.find((p) => tabId(session, p) === session.activeTab) ??
    pages[0] ??
    (await session.browser.context.newPage())
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

async function runAction(
  session: BrowserSession,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
): Promise<ToolResultPart[]> {
  switch (action) {
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
      const png = await page.screenshot({
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
    case 'network':
      return text(
        session.network.map((r) => `${r.method} ${r.status ?? '...'} ${r.url}`).join('\n') ||
          'no network requests recorded',
      )
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
  const { context } = session.browser
  if (op === 'list') {
    const lines = context
      .pages()
      .map((page) => {
        const id = tabId(session, page)
        return `${id === session.activeTab ? '*' : ' '} ${id}  ${clip(page.url())}`
      })
      .join('\n')
    return text(lines)
  }
  if (op === 'new') {
    if (context.pages().length >= MAX_TABS) {
      throw new Error(`${MAX_TABS} tabs are already open; close one first`)
    }
    const url = typeof args.url === 'string' && args.url ? args.url : undefined
    if (url) await checkUrl(url, config)
    const page = await context.newPage()
    session.activeTab = tabId(session, page)
    if (!url) return text(`Opened ${session.activeTab} (about:blank).`)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return text(await freshSnapshot(session, page))
  }
  const id = stringArg(args, 'tabId')
  const page = context.pages().find((p) => tabId(session, p) === id)
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
