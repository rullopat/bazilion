// Run after the web build: pnpm tsx scripts/check-repository-context-ui.mjs
// Disposable daemon/browser acceptance. No real providers or Telegram messages.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findFreePort, startTestServer } from '../apps/cli/test/server-fixture.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const { chromium } = createRequire(new URL('../apps/daemon/package.json', import.meta.url))(
  'playwright',
)
const evidence = mkdtempSync(join(tmpdir(), 'baz039-ui-'))
const daemon = await startTestServer({
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
let browser
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
  const workspace = join(daemon.home, 'teams/default')
  mkdirSync(join(workspace, 'app'))
  writeFileSync(
    join(workspace, 'AGENTS.md'),
    '# Repository guidelines\nUse the local conventions.\n<script>window.__repoExecuted = true</script>\n',
  )
  writeFileSync(
    join(workspace, 'app/AGENTS.md'),
    '# Application guidelines\nNESTED_ACCEPTANCE_SENTINEL\n',
  )
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@10.0.0',
      scripts: { test: 'pnpm vitest run', build: 'pnpm build' },
    }),
  )
  const created = await daemon.cli(['token', 'create', 'ui-acceptance'])
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
  await page.goto(`${url}/teams/default`)
  const card = page.getByRole('region', { name: 'Repository context', exact: true })
  await card.getByRole('button', { name: 'Inspect repository', exact: true }).click()
  await card
    .getByRole('heading', { name: 'Repository instructions — complete', exact: true })
    .waitFor()
  await card
    .locator('summary')
    .filter({ hasText: /^AGENTS.md$/ })
    .click()
  assert.equal(await page.evaluate(() => window.__repoExecuted), undefined)
  const sourceDetails = card.locator('details').filter({ has: page.getByText('Source details and fingerprints', { exact: true }) })
  assert.equal(await sourceDetails.getAttribute('open'), null)
  await card.screenshot({ path: join(evidence, 'desktop.png') })
  await card.getByLabel('File or directory within this Team').fill('app/new.ts')
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await card
    .locator('summary')
    .filter({ hasText: /^app\/AGENTS.md$/ })
    .waitFor()
  await card
    .locator('summary')
    .filter({ hasText: /^app\/AGENTS.md$/ })
    .click()
  assert((await card.textContent()).includes('NESTED_ACCEPTANCE_SENTINEL'))
  writeFileSync(join(workspace, 'app/AGENTS.md'), 'REFRESHED_ACCEPTANCE_SENTINEL\n')
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await page.waitForFunction(() =>
    document.body.textContent.includes('REFRESHED_ACCEPTANCE_SENTINEL'),
  )
  assert(!(await card.textContent()).includes('NESTED_ACCEPTANCE_SENTINEL'))
  await page.setViewportSize({ width: 390, height: 844 })
  await card.screenshot({ path: join(evidence, 'mobile.png') })
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Horizontal overflow on mobile',
  )
  await card.getByLabel('File or directory within this Team').fill('../outside')
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await card
    .getByRole('heading', { name: 'Repository instructions — incomplete', exact: true })
    .waitFor()
  assert((await card.textContent()).includes('Requested target: ../outside'))
  assert.equal(await card.getByRole('status').locator('li').count(), 1)
  assert.equal(await card.locator('pre').count(), 0)
  await card.getByLabel('File or directory within this Team').fill('app/new.ts')
  assert((await card.textContent()).includes('Requested target: ../outside'))
  await card.screenshot({ path: join(evidence, 'incomplete.png') })
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await card.getByRole('heading', { name: 'Repository instructions — complete', exact: true }).waitFor()
  assert((await card.textContent()).includes('Requested target: app/new.ts'))
  await card.locator('summary').filter({ hasText: /^app\/AGENTS.md$/ }).click()
  assert((await card.textContent()).includes('REFRESHED_ACCEPTANCE_SENTINEL'))
  assert.deepEqual(errors, [])
  writeFileSync(
    join(evidence, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'authenticated inspection',
          'root/nested scope',
          'refresh replacement',
          'inert HTML',
          'desktop/mobile layout',
          'unsafe-target reporting',
          'deduplicated errors and captured request target',
          'collapsed source fingerprints',
          'recovery after rejected target',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log(`Repository context UI acceptance passed. Evidence: ${evidence}`)
} finally {
  await browser?.close()
  if (web.exitCode === null) {
    web.kill('SIGTERM')
    await new Promise((resolve) => web.once('exit', resolve))
  }
  await daemon.stop()
}
