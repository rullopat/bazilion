// Daemon-side browser session pool.
//
// One persistent Playwright browser context per agent, keyed by agentId and
// held in the process-lifetime resource registry (see `lib/resources.ts`).
// Sessions survive across turns — cookies, logins, and open tabs carry over —
// and are torn down by the idle reaper, on agent delete, or at shutdown.
//
// The worker's `browser_*` tools never touch Playwright directly: they proxy
// each action back over IPC (`browserInvoke`) to `createBrowserHost`, which
// calls `invokeBrowserAction` here. That keeps the (stateful, heavy) browser
// entirely in the daemon while the per-turn worker stays stateless.
//
// Perception is accessibility-tree-first: `browser_snapshot` returns Playwright's
// AI aria snapshot (text + `[ref=eN]` element refs, no vision model needed) and
// every interaction targets an element by `ref` via the `aria-ref=` selector
// engine. `browser_take_screenshot` is the secondary, vision-only escape hatch.

import type { Browser, BrowserContext, ConsoleMessage, Page, Request } from 'playwright'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import { ensureResourceReaper, resources } from '../resources.ts'
import { getSsrfProxy } from './proxy.ts'
import { browserBlockReason } from './ssrf.ts'

const CONSOLE_CAP = 100
const NETWORK_CAP = 100
const DEFAULT_NAV_TIMEOUT_MS = 30_000

export interface BrowserConfig {
  headless: boolean
  allowPrivate: boolean
  idleMs: number
  maxSessions: number
}

interface ConsoleRecord {
  type: string
  text: string
}
interface NetworkRecord {
  method: string
  url: string
  status: number | null
}

export interface BrowserSession {
  agentId: string
  lastUsedAt: number
  idleMs: number
  browser: Browser
  context: BrowserContext
  /** Index into context.pages() of the currently-focused tab. */
  activeIndex: number
  console: ConsoleRecord[]
  network: NetworkRecord[]
  close(): Promise<void>
}

function activePage(s: BrowserSession): Page {
  const pages = s.context.pages()
  if (pages.length === 0) throw new Error('browser has no open pages')
  const idx = Math.min(s.activeIndex, pages.length - 1)
  const page = pages[idx]
  if (!page) throw new Error('browser has no open pages')
  return page
}

async function createSession(agentId: string, config: BrowserConfig): Promise<BrowserSession> {
  // Lazy dynamic import: the daemon shouldn't load Chromium's native bindings
  // unless an agent actually uses a browser tool this run.
  const { chromium } = await import('playwright')

  // SSRF enforcement: route all egress through a validating forward proxy that
  // resolves DNS itself and dials only the validated IP (closing the rebinding
  // gap a re-resolving interceptor would leave, and covering service-worker
  // traffic that `context.route` cannot see). The `allowPrivate` local-dev
  // escape hatch launches with no proxy for full network access.
  const proxy = config.allowPrivate ? undefined : { server: await getSsrfProxy() }
  const browser = await chromium.launch({
    headless: config.headless,
    ...(proxy ? { proxy } : {}),
  })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    viewport: { width: 1280, height: 800 },
    // Block service workers — defense in depth (their requests already go
    // through the proxy, but this removes a whole class of interception edge
    // cases for an automation browser).
    serviceWorkers: 'block',
  })
  context.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT_MS)
  context.setDefaultTimeout(DEFAULT_NAV_TIMEOUT_MS)

  const session: BrowserSession = {
    agentId,
    lastUsedAt: Date.now(),
    idleMs: config.idleMs,
    browser,
    context,
    activeIndex: 0,
    console: [],
    network: [],
    async close() {
      try {
        await context.close()
      } catch {}
      try {
        await browser.close()
      } catch {}
    },
  }

  context.on('console', (msg: ConsoleMessage) => {
    session.console.push({ type: msg.type(), text: msg.text() })
    if (session.console.length > CONSOLE_CAP) session.console.shift()
  })
  context.on('request', (req: Request) => {
    session.network.push({ method: req.method(), url: req.url(), status: null })
    if (session.network.length > NETWORK_CAP) session.network.shift()
  })
  context.on('response', (res) => {
    const rec = session.network.find((r) => r.url === res.url() && r.status === null)
    if (rec) rec.status = res.status()
  })

  await context.newPage()
  return session
}

/**
 * Get the agent's browser session, launching one on first use. The pool is
 * capped: when full, the least-recently-used session is evicted first.
 */
// In-flight launches keyed by agentId — collapses concurrent first-use of the
// same agent's session into one launch so we never create + orphan a duplicate
// browser (the orphan would escape the pool, reaper, and shutdown).
const inflightBrowsers = new Map<string, Promise<BrowserSession>>()

export async function getOrCreateBrowserSession(
  agentId: string,
  config: BrowserConfig,
): Promise<BrowserSession> {
  const pool = resources().browsers
  const existing = pool.get(agentId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  const pending = inflightBrowsers.get(agentId)
  if (pending) return pending

  const launch = (async () => {
    if (pool.size >= config.maxSessions) {
      let lru: BrowserSession | null = null
      for (const s of pool.values()) {
        if (!lru || s.lastUsedAt < lru.lastUsedAt) lru = s
      }
      if (lru) {
        pool.delete(lru.agentId)
        await lru.close()
      }
    }
    const session = await createSession(agentId, config)
    pool.set(agentId, session)
    ensureResourceReaper()
    return session
  })()
  inflightBrowsers.set(agentId, launch)
  try {
    return await launch
  } finally {
    inflightBrowsers.delete(agentId)
  }
}

/** Close and remove an agent's browser session if present (agent delete / cancel). */
export async function closeBrowserSession(agentId: string): Promise<void> {
  const pool = resources().browsers
  const s = pool.get(agentId)
  if (!s) return
  pool.delete(agentId)
  await s.close()
}

function text(s: string): ToolResultPart[] {
  return [{ type: 'text', text: s }]
}

async function snapshotText(s: BrowserSession): Promise<string> {
  const page = activePage(s)
  const pages = s.context.pages()
  const aria = await page.locator('body').ariaSnapshot({ mode: 'ai' })
  const tabs = pages
    .map((p, i) => `${i === s.activeIndex ? '*' : ' '} [${i}] ${p.url()}`)
    .join('\n')
  return [
    `- Page URL: ${page.url()}`,
    `- Page Title: ${await page.title()}`,
    pages.length > 1 ? `- Open tabs:\n${tabs}` : '',
    '- Accessibility snapshot (interact via ref, e.g. browser_click {"ref":"e5"}):',
    '```yaml',
    aria,
    '```',
  ]
    .filter(Boolean)
    .join('\n')
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v)
    throw new Error(`browser action: "${key}" must be a non-empty string`)
  return v
}

/**
 * Execute one browser action against an agent's session and return the result
 * as multimodal tool output. Called daemon-side by `createBrowserHost`.
 */
export async function invokeBrowserAction(
  agentId: string,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
): Promise<ToolResultPart[]> {
  const session = await getOrCreateBrowserSession(agentId, config)
  session.lastUsedAt = Date.now()
  const page = (): Page => activePage(session)

  // Guard top-level navigations explicitly: a navigation to file:// (or any
  // non-http(s) scheme) never reaches the SSRF proxy, so block it here. For
  // http(s) this also returns a clean error for private targets instead of a
  // bare proxy connection failure.
  async function guardNav(url: string): Promise<void> {
    const reason = await browserBlockReason(url, config.allowPrivate)
    if (reason) throw new Error(`browser navigation blocked: ${reason}`)
  }

  switch (action) {
    case 'navigate': {
      const url = str(args, 'url')
      await guardNav(url)
      await page().goto(url, { waitUntil: 'domcontentloaded' })
      return text(await snapshotText(session))
    }
    case 'snapshot':
      return text(await snapshotText(session))
    case 'click': {
      await page()
        .locator(`aria-ref=${str(args, 'ref')}`)
        .click()
      return text(await snapshotText(session))
    }
    case 'type': {
      const loc = page().locator(`aria-ref=${str(args, 'ref')}`)
      await loc.fill(typeof args.text === 'string' ? args.text : '')
      if (args.submit === true) await loc.press('Enter')
      return text(await snapshotText(session))
    }
    case 'hover': {
      await page()
        .locator(`aria-ref=${str(args, 'ref')}`)
        .hover()
      return text(await snapshotText(session))
    }
    case 'select': {
      const values = Array.isArray(args.values) ? (args.values as string[]) : [str(args, 'value')]
      await page()
        .locator(`aria-ref=${str(args, 'ref')}`)
        .selectOption(values)
      return text(await snapshotText(session))
    }
    case 'fill_form': {
      const fields = Array.isArray(args.fields) ? args.fields : []
      for (const f of fields as Array<{ ref?: string; value?: string }>) {
        if (!f.ref) continue
        await page()
          .locator(`aria-ref=${f.ref}`)
          .fill(f.value ?? '')
      }
      return text(await snapshotText(session))
    }
    case 'press_key': {
      await page().keyboard.press(str(args, 'key'))
      return text(await snapshotText(session))
    }
    case 'go_back': {
      await page().goBack({ waitUntil: 'domcontentloaded' })
      return text(await snapshotText(session))
    }
    case 'tabs': {
      const op = str(args, 'op')
      const pages = session.context.pages()
      if (op === 'list') {
        return text(
          pages
            .map((p, i) => `${i === session.activeIndex ? '*' : ' '} [${i}] ${p.url()}`)
            .join('\n') || 'no open tabs',
        )
      }
      if (op === 'new') {
        if (typeof args.url === 'string' && args.url) await guardNav(args.url)
        await session.context.newPage()
        session.activeIndex = session.context.pages().length - 1
        if (typeof args.url === 'string' && args.url) {
          await activePage(session).goto(args.url, { waitUntil: 'domcontentloaded' })
        }
        return text(await snapshotText(session))
      }
      if (op === 'select') {
        const idx = typeof args.index === 'number' ? args.index : 0
        if (idx < 0 || idx >= pages.length) throw new Error(`no tab at index ${idx}`)
        session.activeIndex = idx
        return text(await snapshotText(session))
      }
      if (op === 'close') {
        const idx = typeof args.index === 'number' ? args.index : session.activeIndex
        const target = pages[idx]
        if (target) await target.close()
        session.activeIndex = 0
        return text(await snapshotText(session))
      }
      throw new Error(`unknown tabs op: ${op} (expected list|new|select|close)`)
    }
    case 'take_screenshot': {
      const buf = await page().screenshot({
        type: 'png',
        fullPage: args.full_page === true,
      })
      return [
        { type: 'text', text: `Screenshot of ${page().url()}` },
        { type: 'image', data: buf.toString('base64'), mimeType: 'image/png' },
      ]
    }
    case 'console': {
      if (session.console.length === 0) return text('no console messages')
      return text(session.console.map((c) => `[${c.type}] ${c.text}`).join('\n'))
    }
    case 'network': {
      if (session.network.length === 0) return text('no network requests recorded')
      return text(
        session.network.map((n) => `${n.method} ${n.status ?? '...'} ${n.url}`).join('\n'),
      )
    }
    default:
      throw new Error(`unknown browser action: ${action}`)
  }
}
