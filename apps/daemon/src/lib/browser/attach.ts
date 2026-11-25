// BROWSER_ATTACH: agents work in a browser that is already running (the operator's own Chrome or
// Chromium, with its logins) instead of one Bazilion starts. Every agent shares one DevTools
// connection, dropped when the last agent's session closes. An agent sees and drives only the
// tabs it opened itself and the tabs those opened; the operator's own tabs are never listed,
// read or closed.

import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import type { AgentBrowser } from './launch.ts'
import { browserBlockReason } from './ssrf.ts'

/** Long enough for the operator to answer Chrome's prompt to allow the connection. */
const CONNECT_MS = 60_000
const HOW_TO_ENABLE =
  'In Chrome 144 or later, open chrome://inspect/#remote-debugging and allow remote debugging; ' +
  'or start the browser with --remote-debugging-port and set BROWSER_ATTACH_URL.'

export interface RunningBrowser {
  name: string
  /** The browser's DevTools WebSocket endpoint. */
  endpoint: string
}

/** The default profile directories of Chrome and Chromium, where a running one publishes its port. */
export function runningBrowserDirs(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): Array<{ name: string; dir: string }> {
  if (platform === 'darwin') {
    const root = join(home, 'Library', 'Application Support')
    return [
      { name: 'Google Chrome', dir: join(root, 'Google', 'Chrome') },
      { name: 'Google Chrome Beta', dir: join(root, 'Google', 'Chrome Beta') },
      { name: 'Google Chrome Canary', dir: join(root, 'Google', 'Chrome Canary') },
      { name: 'Chromium', dir: join(root, 'Chromium') },
    ]
  }
  const root = process.env.XDG_CONFIG_HOME || join(home, '.config')
  return [
    { name: 'Google Chrome', dir: join(root, 'google-chrome') },
    { name: 'Google Chrome Beta', dir: join(root, 'google-chrome-beta') },
    { name: 'Google Chrome Dev', dir: join(root, 'google-chrome-unstable') },
    { name: 'Chromium', dir: join(root, 'chromium') },
    { name: 'Chromium', dir: join(home, 'snap', 'chromium', 'common', 'chromium') },
  ]
}

/** The endpoint in a `DevToolsActivePort` file (port, then path), or null when it holds none. */
export function parseDevToolsActivePort(content: string): string | null {
  const [port, path] = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!port || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) return null
  if (!path?.startsWith('/')) return null
  return `ws://127.0.0.1:${port}${path}`
}

/** Whether something listens at the endpoint: a browser that quit leaves its port file behind. */
function isListening(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(new URL(endpoint).port) })
    const done = (listening: boolean) => {
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(1_000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** The running Chrome or Chromium that accepts remote debugging, or an error saying how to allow it. */
export async function findRunningBrowser(dirs = runningBrowserDirs()): Promise<RunningBrowser> {
  let denied: string | undefined
  for (const { name, dir } of dirs) {
    let content: string
    try {
      content = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') denied = dir
      continue
    }
    const endpoint = parseDevToolsActivePort(content)
    if (endpoint && (await isListening(endpoint))) return { name, endpoint }
  }
  throw new Error(
    denied
      ? `Cannot read ${denied}: the system denies the daemon access to the browser's folder. On macOS, allow the terminal that runs Bazilion under System Settings > Privacy & Security > Files & Folders, or set BROWSER_ATTACH_URL.`
      : `No running Chrome or Chromium accepts remote debugging. ${HOW_TO_ENABLE}`,
  )
}

interface Connection {
  browser: Browser
  context: BrowserContext
  /** The frames of every agent's tab on this connection: downloads they start are cancelled. */
  agentFrames: Map<Page, Set<string>>
}

interface Shared {
  opened: Promise<Connection>
  /** Agent sessions on this connection, counted from the moment they ask for it. */
  users: number
}

// One connection per BROWSER_ATTACH_URL value ('' is the browser found on this machine).
const connections = new Map<string, Shared>()

async function openConnection(url: string | undefined): Promise<Connection> {
  const target = url ? { name: url, endpoint: url } : await findRunningBrowser()
  const { chromium } = await import('playwright')
  let browser: Browser
  try {
    // noDefaults: without it Playwright treats the default context as its own and applies its
    // test settings to the whole browser, the operator's tabs included: their downloads go to a
    // temporary folder of its own, deleted when the connection closes, and focus and colour
    // scheme are emulated. Agents' tabs get what they need one by one (setUpAgentTab).
    browser = await chromium.connectOverCDP(target.endpoint, {
      timeout: CONNECT_MS,
      noDefaults: true,
      ...(url ? {} : { isLocal: true }),
    })
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0]
    throw new Error(
      `Could not attach to ${target.name}: ${detail}. If the browser asks whether to allow remote debugging, allow it and try again.`,
    )
  }
  const context = browser.contexts()[0]
  if (!context) {
    await browser.close().catch(() => {})
    throw new Error(`${target.name} has no browser window to work in`)
  }
  const agentFrames = new Map<Page, Set<string>>()
  try {
    await refuseAgentDownloads(browser, agentFrames)
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
  return { browser, context, agentFrames }
}

/**
 * Cancel each download that starts in an agent's tab, and delete one that finished before the
 * cancel landed; every other download is left to the browser. The browser has no setting for
 * one tab: Page.setDownloadBehavior applies to all of them, the operator's included. The
 * session lives as long as the connection, and the browser forgets these events when it ends.
 */
async function refuseAgentDownloads(
  browser: Browser,
  agentFrames: Map<Page, Set<string>>,
): Promise<void> {
  const cdp = await browser.newBrowserCDPSession()
  const refused = new Set<string>()
  cdp.on('Browser.downloadWillBegin', ({ guid, frameId }) => {
    if (![...agentFrames.values()].some((frames) => frames.has(frameId))) return
    refused.add(guid)
    cdp.send('Browser.cancelDownload', { guid }).catch(() => {})
  })
  cdp.on('Browser.downloadProgress', ({ guid, state, filePath }) => {
    if (!refused.has(guid) || state === 'inProgress') return
    refused.delete(guid)
    if (state === 'completed' && filePath) rm(filePath, { force: true }).catch(() => {})
  })
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true })
}

function acquire(url: string | undefined): Shared {
  const key = url ?? ''
  let shared = connections.get(key)
  if (!shared) {
    const created: Shared = { opened: openConnection(url), users: 0 }
    const drop = () => {
      if (connections.get(key) === created) connections.delete(key)
    }
    // A browser that quit, or never answered, is looked up again at the next call.
    created.opened.then(({ browser }) => browser.once('disconnected', drop), drop)
    connections.set(key, created)
    shared = created
  }
  shared.users++
  return shared
}

/** Give the connection back; the last session to do so disconnects, and the browser keeps running. */
async function release(url: string | undefined, shared: Shared): Promise<void> {
  if (--shared.users > 0) return
  if (connections.get(url ?? '') === shared) connections.delete(url ?? '')
  // close() on a browser Playwright connected to only disconnects.
  await shared.opened.then(({ browser }) => browser.close()).catch(() => {})
}

/**
 * No proxy stands between an attached browser and the network, so each request of an agent's tab
 * is checked here instead. Weaker than the proxy: a service worker's requests, the first request
 * of a tab a page opened and a DNS answer that changes after the check are not covered.
 */
async function refusePrivateRequests(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    try {
      const reason = await browserBlockReason(route.request().url(), false)
      await (reason ? route.abort('blockedbyclient') : route.continue())
    } catch {
      // The tab closed while the request was being checked.
    }
  })
}

/**
 * Settings for the agent's tab only; the operator's own tabs keep the browser's. Its frames are
 * listed so that downloads they start are cancelled (refuseAgentDownloads), and the tab acts as
 * focused, as Playwright's default would make every tab: a tab in the background otherwise never
 * settles for a click.
 */
async function setUpAgentTab(
  context: BrowserContext,
  page: Page,
  agentFrames: Map<Page, Set<string>>,
): Promise<void> {
  const frames = new Set<string>()
  agentFrames.set(page, frames)
  page.once('close', () => agentFrames.delete(page))
  const cdp = await context.newCDPSession(page)
  cdp.on('Page.frameAttached', ({ frameId }) => frames.add(frameId))
  await cdp.send('Page.enable')
  const add = (tree: { frame: { id: string }; childFrames?: (typeof tree)[] }) => {
    frames.add(tree.frame.id)
    for (const child of tree.childFrames ?? []) add(child)
  }
  add((await cdp.send('Page.getFrameTree')).frameTree)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
}

export interface AttachOptions {
  /** BROWSER_ATTACH_URL; unset means the Chrome or Chromium running on this machine. */
  url?: string
  /** BROWSER_ALLOW_PRIVATE_NETWORK: skip the per-request private-address check. */
  allowPrivate: boolean
}

/** One agent's session in the attached browser. */
export async function attachBrowser(opts: AttachOptions): Promise<AgentBrowser> {
  const shared = acquire(opts.url)
  let connection: Connection
  try {
    connection = await shared.opened
  } catch (error) {
    await release(opts.url, shared)
    throw error
  }
  const { browser, context, agentFrames } = connection
  const owned = new Set<Page>()

  /** Take a tab as the agent's; `ready` resolves once its guards are in place. */
  const own = (page: Page): Promise<unknown> => {
    owned.add(page)
    page.once('close', () => owned.delete(page))
    page.on('popup', (popup) => void own(popup))
    page.setDefaultNavigationTimeout(30_000)
    page.setDefaultTimeout(10_000)
    return Promise.all([
      opts.allowPrivate ? undefined : refusePrivateRequests(page),
      setUpAgentTab(context, page, agentFrames),
    ]).catch(() => {}) // the tab closed first
  }

  let closed: Promise<void> | undefined
  return {
    context,
    get running() {
      return browser.isConnected()
    },
    pages: () => context.pages().filter((page) => owned.has(page)),
    owns: (page) => page !== null && owned.has(page),
    async newPage() {
      const page = await context.newPage()
      await own(page)
      return page
    },
    close() {
      closed ??= (async () => {
        await Promise.all([...owned].map((page) => page.close().catch(() => {})))
        await release(opts.url, shared)
      })()
      return closed
    },
  }
}
