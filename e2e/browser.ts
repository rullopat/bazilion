// A signed-in browser page on an instance, in the operator's installed Chrome (or Chromium), and
// everything that went wrong on it: uncaught page errors, console errors (React's hydration
// warnings among them) and failed requests.

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import { findBrowserExecutable } from '../apps/daemon/src/lib/browser/executable.ts'
import type { Instance } from './instance.ts'

/** The shortcut hints read "Ctrl K" in the pictures, whatever computer takes them. */
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

export interface SessionOptions {
  width?: number
  height?: number
  dark?: boolean
  scale?: number
  locale?: string
  timezoneId?: string
  /** Cookies to set before signing in, such as which Teams the list shows unfolded. */
  cookies?: { name: string; value: string }[]
}

export interface Session {
  context: BrowserContext
  page: Page
  /** What went wrong so far; tests expect it empty. */
  problems: string[]
  /** Go to a path of the web UI and wait for it to settle. */
  go(path: string, settleMs?: number): Promise<void>
  close(): Promise<void>
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.BAZILION_E2E_BROWSER ?? findBrowserExecutable().path,
  })
}

export async function signIn(
  browser: Browser,
  instance: Instance,
  options: SessionOptions = {},
): Promise<Session> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    deviceScaleFactor: options.scale ?? 1,
    colorScheme: options.dark ? 'dark' : 'light',
    userAgent: LINUX_CHROME,
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.timezoneId ? { timezoneId: options.timezoneId } : {}),
  })
  if (options.cookies?.length) {
    await context.addCookies(
      options.cookies.map((cookie) => ({ ...cookie, domain: '127.0.0.1', path: '/' })),
    )
  }
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`page error: ${String(error).slice(0, 400)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 400)}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      problems.push(
        `HTTP ${response.status()} ${response.request().method()} ${response.url().replace(instance.web, '')}`,
      )
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? ''
    // A navigation cancels what the page was still loading, the live stream included.
    if (!failure.includes('ERR_ABORTED'))
      problems.push(`failed: ${request.url().replace(instance.web, '')} ${failure}`)
  })
  await page.goto(`${instance.web}/login`)
  await page.fill('#token', instance.token)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.click('button[type=submit]'),
  ])
  await page.waitForLoadState('load')
  return {
    context,
    page,
    problems,
    async go(path, settleMs = 800) {
      await page.mouse.move(2, 2)
      // The live stream stays open, so the network never goes idle: wait for the page instead.
      await page.goto(`${instance.web}${path}`, { waitUntil: 'load' })
      await page.waitForTimeout(settleMs)
    },
    close: () => context.close(),
  }
}
