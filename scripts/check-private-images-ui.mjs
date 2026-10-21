// Offline browser projection of operator private-image recovery/discard, not live generation.
// Requires a current web build and installed Chromium. No downloads/providers/operator profiles.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { seedPrivateImagesForUi } from '../apps/cli/test/fixtures/private-images.ts'
import { findFreePort } from '../apps/cli/test/server-fixture.ts'
import { InstallerProcesses, readBoundedText } from './testing/installer-process.mjs'

const evidence = process.argv[2]
assert(evidence, 'Provide an unused evidence directory')
mkdirSync(evidence, { mode: 0o700 })
const root = new URL('..', import.meta.url).pathname
const { chromium } = createRequire(new URL('../apps/daemon/package.json', import.meta.url))(
  'playwright',
)
const processes = new InstallerProcesses()
let daemon, web, browser
const cleanupErrors = []
let passed = false
let failure
const home = join(evidence, 'home')
mkdirSync(home, { mode: 0o700 })
const daemonPort = await findFreePort()
const daemonUrl = `http://127.0.0.1:${daemonPort}`
const startDaemon = () =>
  processes.spawn(
    process.execPath,
    ['--import', 'tsx/esm', join(root, 'apps/daemon/src/index.ts')],
    {
      cwd: root,
      env: {
        ...process.env,
        BAZILION_HOME: home,
        HOST: '127.0.0.1',
        PORT: String(daemonPort),
        BAZILION_BASH_SANDBOX: 'off',
        BAZILION_SCHEDULER: 'off',
        BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
        BAZILION_IMAGE_GENERATION: 'off',
        BROWSER_ENABLED: 'false',
        BAZILION_PUBLIC_ORIGIN: '',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_CHAT_ID: '',
      },
    },
  )
try {
  daemon = startDaemon()
  await processes.healthy(daemon, `${daemonUrl}/api/health`)
  await processes.stop(daemon, { graceful: true })
  // Seed only while the fixture daemon is closed: it remains the sole runtime DB owner.
  const fixture = seedPrivateImagesForUi(home)
  daemon = startDaemon()
  await processes.healthy(daemon, `${daemonUrl}/api/health`)
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}`
  web = processes.spawn(
    process.execPath,
    ['--import', 'tsx/esm', join(root, 'apps/cli/src/web-server.ts')],
    {
      cwd: root,
      env: {
        ...process.env,
        BAZILION_PUBLIC_ORIGIN: '',
        BAZILION_DAEMON: daemonUrl,
        BAZILION_WEB_DIST: join(root, 'apps/web/dist'),
        WEB_HOST: '127.0.0.1',
        WEB_PORT: String(port),
      },
    },
  )
  const deadline = Date.now() + 20000
  while (true) {
    assert(
      processes.facts().at(-1).outcome.cleanup === 'unconfirmed',
      'Web exited before readiness',
    )
    let response
    try {
      response = await fetch(`${url}/login`, {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      })
    } catch (error) {
      assert(Date.now() < deadline, `Web readiness failed: ${error}`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    assert.equal(response.status, 200)
    assert((await readBoundedText(response, 256 * 1024)).includes('Open Bazilion'))
    break
  }
  browser = await chromium.launch({
    executablePath: process.env.BAZILION_UI_CHROMIUM ?? '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${url}/login`)
  await page.getByLabel('Access token', { exact: true }).fill(fixture.credential)
  await page.getByRole('button', { name: 'Open Bazilion', exact: true }).click()
  await page.waitForURL((next) => !next.pathname.startsWith('/login'))
  await page.goto(`${url}/teams/default/results`)
  const panel = page.getByRole('region', { name: 'Retained private images' })
  await panel.getByText(/2 private captures in selection/).waitFor()
  const privateHtml = await panel.innerHTML()
  assert(!privateHtml.includes('recover-private-image.png'))
  assert(!privateHtml.includes(fixture.png.toString('base64')))
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Horizontal overflow',
    )
    await page.screenshot({ path: join(evidence, `private-${width}.png`), fullPage: true })
  }
  const recoverResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/private-images/${fixture.recoverId}/recover`) &&
      response.request().method() === 'POST',
  )
  await panel
    .getByRole('listitem')
    .filter({ hasText: fixture.recoverId })
    .getByRole('button', { name: 'Recover through Team Policy' })
    .click()
  assert.equal((await recoverResponse).status(), 200)
  await panel
    .getByText('Image is available in saved Results below. No generation was requested.')
    .waitFor()
  await page.getByText('recover-private-image.png', { exact: true }).waitFor()
  const downloaded = await page.request.get(`${url}/api/results/${fixture.recoverId}/download`)
  assert.equal(downloaded.status(), 200)
  assert((await downloaded.body()).equals(fixture.png))
  const discardedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/private-images/${fixture.discardId}/discard`) &&
      response.request().method() === 'POST',
  )
  await panel
    .getByRole('listitem')
    .filter({ hasText: fixture.discardId })
    .getByRole('button', { name: 'Discard private image', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Permanently discard', exact: true })
    .click()
  assert.equal((await discardedResponse).status(), 200)
  await panel.getByText(/0 private captures in selection/).waitFor()
  assert.equal(
    (await page.request.get(`${url}/api/results/${fixture.discardId}/download`)).status(),
    404,
  )
  assert.deepEqual(pageErrors, [])
  await page.screenshot({ path: join(evidence, 'recovered-and-discarded.png'), fullPage: true })
  passed = true
} catch (error) {
  failure = String(error?.stack ?? error).slice(0, 8192)
  throw error
} finally {
  try {
    await browser?.close()
  } catch (error) {
    cleanupErrors.push(String(error))
  }
  try {
    await processes.stop(web, { graceful: true })
    await processes.closeAll()
  } catch (error) {
    cleanupErrors.push(String(error))
  }
  try {
    await processes.stop(daemon, { graceful: true })
    await processes.closeAll()
  } catch (error) {
    cleanupErrors.push(String(error))
  }
  // Retain the synthetic home/evidence; never erase state on unknown or abnormal cleanup.
  writeFileSync(
    join(evidence, 'outcome.json'),
    JSON.stringify(
      {
        passed: passed && cleanupErrors.length === 0,
        failure,
        profile: 'synthetic committed images; real source daemon/web/browser, no provider requests',
        scope:
          'minimal inventory, cookie/CSRF operator recovery, exact bytes, confirmed discard, desktop/mobile projection',
        cleanupLimit:
          'Owned web child/pipe and fixture/Playwright lifecycle; not arbitrary-descendant proof; caller private containment required',
        processes: processes.facts(),
        cleanupErrors,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  )
  assert.equal(cleanupErrors.length, 0, `Cleanup not accepted: ${cleanupErrors}`)
}
