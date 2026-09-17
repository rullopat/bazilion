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

/**
 * Run a CLI command that the observation depends on, and fail loudly if it did not succeed. The CLI
 * fixture resolves with the exit code rather than throwing, so an unexplained failure would leave the
 * harness asserting against state that was never created.
 */
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

  // ---------------------------------------------------------------------------------------------
  // BAZ-045: the review-packet panel and the verification panel, observed rather than unit-tested.
  // ---------------------------------------------------------------------------------------------
  // A packet with two findings in different states, so "an unverified finding cannot be resolved" is
  // observed as a contrast: exactly one resolve control, on the finding that is open.
  const snapshotList = await mustCli(['team', 'review', 'snapshots', 'default', '--json'])
  const snapshotId = snapshotList.stdout.match(/[0-9a-f]{64}/)?.[0]
  assert(snapshotId, 'no retained snapshot to review')
  await mustCli([
    'agent',
    'spawn',
    '--profile',
    'default',
    '--name',
    'reviewer',
    '--team',
    'default',
  ])
  const packetOut = await mustCli([
    'team',
    'review',
    'packet',
    'create',
    'default',
    '--snapshot',
    snapshotId,
    '--summary',
    'the new line is untested',
    '--json',
  ])
  const packetId = packetOut.stdout.match(/"id":\s*"([0-9a-f-]{36})"/)?.[1]
  assert(packetId, `packet id not found in: ${packetOut.stdout.slice(0, 200)}`)
  await mustCli([
    'team',
    'review',
    'packet',
    'finding',
    'default',
    packetId,
    '--path',
    'src/app.txt',
    '--severity',
    'major',
    '--note',
    'the new branch has no test',
    '--lines',
    '3',
  ])
  // Move the tree, so the next finding cannot be correlated to the reviewed revision.
  writeFileSync(join(workspace, 'src/app.txt'), 'alpha\nbeta\ngamma\ndelta\n')
  await mustCli([
    'team',
    'review',
    'packet',
    'finding',
    'default',
    packetId,
    '--path',
    'notes.txt',
    '--severity',
    'info',
    '--note',
    'untracked scratch should not ship',
  ])
  await mustCli([
    'team',
    'review',
    'packet',
    'conclude',
    'default',
    packetId,
    '--conclusion',
    'changes_requested',
    '--note',
    'one issue, one note',
  ])

  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`${url}/teams/default/review`)
  const packets = page.getByRole('region', { name: 'Review packets' })
  await packets.getByRole('heading', { name: 'Review packets' }).waitFor()
  const packetText = await packets.innerText()
  assert(packetText.includes('changes_requested'), 'the conclusion is not stated')
  assert(/2 finding\(s\), 2 unresolved/.test(packetText), `counts missing: ${packetText}`)
  await packets.getByRole('button', { name: 'Details', exact: true }).first().click()
  const detail = await packets.innerText()
  await page.waitForFunction(() => document.body.innerText.includes('applicability:'), undefined, {
    timeout: 10_000,
  })
  await page.screenshot({ path: join(evidence, 'packet.png') })
  writeFileSync(join(evidence, 'packet.txt'), await packets.innerText())
  const reviewed = await packets.innerText()
  assert(reviewed.includes('the new branch has no test'), 'the open finding is not readable')
  assert(
    reviewed.includes('untracked scratch should not ship'),
    'the unverified finding is not readable',
  )
  assert(reviewed.includes('UNVERIFIED'), 'an uncorrelated finding is not labelled')
  assert(reviewed.includes('applicability:'), 'applicability is not stated')
  assert(
    reviewed.includes('conclusion is not acceptance'),
    'the panel stopped saying a conclusion is not acceptance',
  )
  // The discriminator: the open finding offers a resolve control, the unverified one must not.
  assert.equal(
    await packets.getByRole('button', { name: 'Resolve explicitly', exact: true }).count(),
    1,
    'an unverified finding must not offer a resolve control, and an open one must',
  )
  assert(packetText.length > 0 && detail.length > 0)

  // Narrow screen on the packet panel: still readable, still no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  await packets.getByRole('heading', { name: 'Review packets' }).waitFor()
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Horizontal overflow on a narrow screen (review packets)',
  )
  await page.screenshot({ path: join(evidence, 'packet-narrow.png') })

  // The verification panel: a captured request with nothing run yet, and the limits it must state.
  await page.setViewportSize({ width: 1280, height: 1000 })
  await mustCli([
    'team',
    'verify',
    'create',
    'default',
    '--agent',
    'reviewer',
    '--snapshot',
    snapshotId,
    '--check',
    'pnpm test :: unit suite',
    '--summary',
    'confirm the change before review',
  ])
  await page.goto(`${url}/teams/default/verifications`)
  const requests = page.getByRole('region', { name: 'Verification requests' })
  await requests.getByRole('heading', { name: 'Requests' }).waitFor()
  await requests.getByText('pnpm test').waitFor({ timeout: 15_000 })
  const requestText = await requests.innerText()
  await page.screenshot({ path: join(evidence, 'verifications.png') })
  writeFileSync(join(evidence, 'verifications.txt'), requestText)
  assert(requestText.includes('pending'), `the request state is not stated: ${requestText}`)
  assert(requestText.includes('pnpm test'), 'the captured check is not readable')
  // BAZ-045: the two facts the result message carries, stated on the surface the operator reads.
  assert(
    requestText.includes('not an approval to publish, merge or deploy'),
    'the panel stopped saying this is not an approval',
  )
  assert(
    requestText.includes('Declared output paths are not enforced'),
    'the panel implies declared output paths are confined',
  )

  // A Team with no requests reads as an empty state, never as an error.
  await page.goto(`${url}/teams/plain/verifications`)
  await page.getByText('No verification requests yet.').waitFor()

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
          'review packet panel: counts, conclusion, open vs unverified finding, applicability, and one resolve control',
          'review packet panel: no horizontal overflow on a narrow screen',
          'verification panel: captured check, pending state, and both stated limits',
          'verification panel: empty state for a Team with no requests',
        ],
        artifacts: [
          'desktop.png',
          'narrow.png',
          'unavailable.png',
          'panel.txt',
          'packet.png',
          'packet.txt',
          'packet-narrow.png',
          'verifications.png',
          'verifications.txt',
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log(`Coding review and verification UI acceptance passed. Evidence: ${evidence}`)
} finally {
  await browser?.close()
  if (web.exitCode === null) {
    web.kill('SIGTERM')
    await new Promise((resolve) => web.once('exit', resolve))
  }
  await daemon.stop()
}
