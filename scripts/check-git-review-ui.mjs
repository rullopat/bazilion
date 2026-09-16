// Browser acceptance for the Git review panel (BAZ-042 slice 5b).
//
// Run after the web build: pnpm tsx scripts/check-git-review-ui.mjs
// Disposable daemon/browser only: no real providers, no personal state.
//
// Covers what the unit tests cannot: keyboard row selection, the narrow-screen layout, an empty
// repository, and the unavailable state for a Team that is not a repository.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
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
const evidence = mkdtempSync(join(tmpdir(), 'baz042-ui-'))

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Acceptance',
      GIT_AUTHOR_EMAIL: 'acceptance@example.invalid',
      GIT_COMMITTER_NAME: 'Acceptance',
      GIT_COMMITTER_EMAIL: 'acceptance@example.invalid',
    },
  }).trim()
}

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

  // Cross the first-run gate, then build a real repository inside the Team's workspace.
  await daemon.cli(['provider', 'enable', 'lmstudio'])
  await daemon.cli(['provider', 'models-set', 'lmstudio', 'acceptance-model'])
  const workspace = join(daemon.home, 'teams/default')
  git(workspace, 'init', '-q', '-b', 'main')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'src/app.txt'), 'alpha\nbeta\n')
  git(workspace, 'add', '.')
  git(workspace, 'commit', '-qm', 'baseline')
  // A dirty start retained as prior work, plus an untracked file that must stay name-only.
  writeFileSync(join(workspace, 'src/app.txt'), 'alpha\nbeta\ngamma\n')
  writeFileSync(join(workspace, 'notes.txt'), 'scratch\n')
  // A second Team that is not a repository, for the unavailable state.
  await daemon.cli(['team', 'add', 'plain'])

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

  await page.goto(`${url}/teams/default/review`)
  const list = page.getByRole('region', { name: 'Changes since baseline' })
  await list.getByRole('heading', { name: 'Changes since baseline' }).waitFor()
  // The pinned baseline is stated, not implied.
  assert(/base HEAD \([0-9a-f]{12}\)/.test(await page.locator('body').innerText()))
  const row = list.getByRole('button', { name: /src\/app\.txt/ })
  await row.waitFor()
  assert((await row.textContent()).includes('+1'))
  const untracked = list.getByRole('button', { name: /notes\.txt/ })
  assert((await untracked.textContent()).includes('content not selected'))
  await page.screenshot({ path: join(evidence, 'desktop.png') })
  // The rendered text is the evidence a reviewer can actually read, unlike a screenshot alone.
  writeFileSync(join(evidence, 'panel.txt'), await page.locator('body').innerText())

  // Keyboard-only selection: focus the row and activate it without a pointer.
  await row.focus()
  await page.keyboard.press('Enter')
  const diff = page.getByRole('region', { name: 'Selected file diff' })
  await diff.getByRole('heading', { name: 'src/app.txt' }).waitFor()
  assert((await diff.locator('pre').textContent()).includes('+gamma'))

  // Snapshot capture from the panel, then the retained list.
  await page.getByRole('button', { name: 'Capture snapshot', exact: true }).click()
  const snapshots = page.getByRole('region', { name: 'Source snapshots' })
  await snapshots
    .getByRole('button', { name: /complete/ })
    .first()
    .waitFor({ timeout: 15_000 })
  assert((await snapshots.textContent()).includes('complete'))

  // Narrow screen: still readable, no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  await row.waitFor()
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Horizontal overflow on a narrow screen',
  )
  await page.screenshot({ path: join(evidence, 'narrow.png') })

  // A Team that is not a repository must say so, never render an empty change list.
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`${url}/teams/plain/review`)
  await page.getByText(/not a Git repository/).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Changes since baseline' }).count(), 0)
  await page.screenshot({ path: join(evidence, 'unavailable.png') })

  assert.deepEqual(errors, [])
  writeFileSync(
    join(evidence, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'pinned baseline stated',
          'change list with counts and untracked name-only',
          'keyboard row selection opens the diff',
          'snapshot capture reaches the retained list',
          'narrow screen without horizontal overflow',
          'non-repository Team reports unavailable, not empty',
        ],
        artifacts: ['desktop.png', 'narrow.png', 'unavailable.png', 'panel.txt'],
        errors,
      },
      null,
      2,
    ),
  )
  console.log(`Git review UI acceptance passed. Evidence: ${evidence}`)
} finally {
  await browser?.close()
  if (web.exitCode === null) {
    web.kill('SIGTERM')
    await new Promise((resolve) => web.once('exit', resolve))
  }
  await daemon.stop()
}
