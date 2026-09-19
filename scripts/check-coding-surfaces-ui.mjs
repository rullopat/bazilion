// Browser acceptance for the post-hardening UI consistency sweep (BAZ-050).
//
// Run after the web build: pnpm tsx scripts/check-coding-surfaces-ui.mjs
// Disposable daemon/browser only: no real providers, no personal state.
//
// Covers what unit tests cannot: every coding-sequence surface renders at
// desktop and narrow viewport without horizontal overflow, fresh-home empty
// states are the app's shared components, and — the sweep's core assertion —
// a dead daemon renders the route's recovery component (role="alert"), never
// a blank content area or TanStack's developer-grade default error screen.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findFreePort, startTestServer } from '../apps/cli/test/server-fixture.ts'

const root = new URL('..', import.meta.url).pathname
const { chromium } = createRequire(new URL('../apps/daemon/package.json', import.meta.url))(
  'playwright',
)
const evidence = mkdtempSync(join(tmpdir(), 'baz050-ui-'))

const daemon = await startTestServer({
  BAZILION_BASH_SANDBOX: 'off',
  BAZILION_SCHEDULER: 'off',
  BAZILION_PUBLIC_ORIGIN: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
})
const port = await findFreePort()
const url = `http://127.0.0.1:${port}`
const web = spawn(
  process.execPath,
  ['--import', 'tsx/esm', join(root, 'apps/cli/src/web-server.ts')],
  {
    cwd: root,
    env: {
      ...process.env,
      BAZILION_PUBLIC_ORIGIN: '',
      BAZILION_DAEMON: daemon.url,
      BAZILION_WEB_DIST: join(root, 'apps/web/dist'),
      WEB_HOST: '127.0.0.1',
      WEB_PORT: String(port),
    },
    stdio: 'ignore',
  },
)

async function mustCli(args) {
  const result = await daemon.cli(args)
  assert.equal(
    result.exitCode,
    0,
    `cli ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
  )
  return result
}

let browser
let daemonDead = false
try {
  const deadline = Date.now() + 20_000
  while (true) {
    try {
      if ((await fetch(`${url}/login`)).ok) break
    } catch {}
    if (web.exitCode !== null || Date.now() > deadline)
      throw new Error('Disposable web server did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  await daemon.cli(['provider', 'enable', 'lmstudio'])
  await daemon.cli(['provider', 'models-set', 'lmstudio', 'acceptance-model'])
  await mustCli(['agent', 'spawn', '--profile', 'default', '--name', 'sweeper'])
  const created = await mustCli(['token', 'create', 'ui-acceptance'])
  const token = created.stdout.match(/token:\s+([0-9a-f]+)/)?.[1]
  assert(token)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${url}/login`)
  await page.getByLabel('Access token', { exact: true }).fill(token)
  await page.getByRole('button', { name: 'Open Bazilion', exact: true }).click()
  await page.waitForURL((next) => !next.pathname.startsWith('/login'))

  /**
   * Render a route at both viewports; assert the content mounted (selector must
   * appear) and that neither viewport horizontally overflows. Screenshots and
   * rendered text land in the evidence directory.
   */
  async function walk(pathname, mountSelector, label) {
    for (const [w, h, tag] of [
      [1280, 1000, 'desktop'],
      [390, 844, 'narrow'],
    ]) {
      await page.setViewportSize({ width: w, height: h })
      await page.goto(`${url}${pathname}`, { waitUntil: 'domcontentloaded' })
      await page.locator(mountSelector).first().waitFor({ timeout: 15_000 })
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Horizontal overflow at ${w}x${h}: ${pathname}`,
      )
      await page.screenshot({ path: join(evidence, `${label}-${tag}.png`) })
      writeFileSync(join(evidence, `${label}-${tag}.txt`), await page.locator('body').innerText())
    }
  }

  // Fresh home: every coding-sequence surface renders its empty/initial state.
  await walk('/agents', 'h1', 'agents')
  await walk('/agents/sweeper/inbox', 'h1, h2', 'inbox')
  await walk('/agents/sweeper/learning', 'h1, h2', 'learning')
  await walk('/agents/sweeper/triggers', 'h1, h2', 'triggers')
  await walk('/skills', 'h1', 'skills')
  await walk('/templates', 'h1, h2', 'templates')
  await walk('/templates/agents', 'h1, h2', 'templates-agents')
  await walk('/config/services', 'h1, h2', 'services')
  await walk('/config/mcp', 'h1, h2', 'mcp')
  await walk('/config/tokens', 'h1, h2', 'tokens')

  // The fixture home bootstraps the 'default' Team; its scoped surfaces now
  // have real tabs and rosters to render.
  for (const tab of ['', '/activity', '/context', '/members', '/memory', '/policy', '/review', '/results', '/verifications']) {
    await walk(`/teams/default${tab}`, 'h1, h2', `team${tab.replaceAll('/', '-') || '-overview'}`)
  }

  // Team-scoped empty states are the app's shared components, asserted on the
  // page the operator actually sees.
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`${url}/teams/default/results`)
  await page.getByText(/No saved results|no results/i).waitFor({ timeout: 15_000 })

  // The sweep's core assertion: with the daemon dead, each surface renders its
  // recovery component — role="alert", retry, safe exit — never a blank content
  // area and never TanStack's default error screen.
  // The daemon dies for real here; the finally's stop must not wait on an
  // already-closed process ('close' does not re-fire).
  daemonDead = true
  await daemon.stop({ keepHome: true })
  const alertRoutes = [
    ['/teams/default/verifications', 'Specialist verification unavailable'],
    ['/teams/default/review', 'Change review unavailable'],
    ['/teams/default/results', 'Saved results unavailable'],
    ['/teams/default/members', 'Team members unavailable'],
    ['/agents/sweeper/learning', 'Agent learning unavailable'],
    ['/config/tokens', 'Access tokens unavailable'],
    ['/skills', 'Skills unavailable'],
  ]
  for (const [pathname, title] of alertRoutes) {
    await page.goto(`${url}${pathname}`, { waitUntil: 'domcontentloaded' })
    const alert = page.getByRole('alert')
    await alert.waitFor({ timeout: 15_000 })
    const text = await alert.innerText()
    assert(text.includes(title), `${pathname}: alert does not name the surface (wanted "${title}", got "${text.slice(0, 120)}")`)
    assert(text.includes('retry'), `${pathname}: no retry affordance`)
    await page.screenshot({ path: join(evidence, `error${pathname.replaceAll('/', '-')}.png`) })
  }

  // A route without a specific errorComponent (the agent chat page was not
  // touched by the sweep) falls to the router default.
  await page.goto(`${url}/agents/sweeper`, { waitUntil: 'domcontentloaded' })
  const fallback = await page.getByRole('alert').innerText()
  assert(fallback.includes('This page could not be loaded'), `router default missing: ${fallback.slice(0, 120)}`)
  await page.screenshot({ path: join(evidence, 'error-router-default.png') })

  writeFileSync(join(evidence, 'pageerrors.txt'), errors.join('\n') || 'none')
  if (errors.length > 0) throw new Error(`Uncaught page errors: ${errors[0]}`)
  console.log(`BAZ-050 browser acceptance passed. Evidence: ${evidence}`)
} finally {
  await browser?.close()
  if (web.exitCode === null) {
    web.kill('SIGTERM')
    await new Promise((resolve) => web.once('exit', resolve))
  }
  if (!daemonDead) await daemon.stop()
  else await Promise.race([daemon.stop(), new Promise((r) => setTimeout(r, 500))])
}
