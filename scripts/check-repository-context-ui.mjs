// Run after the web build: pnpm tsx scripts/check-repository-context-ui.mjs
// Disposable daemon/browser acceptance. No real providers or Telegram messages.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
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
let providerCalls = 0
const provider = createServer(async (request, response) => {
  for await (const _chunk of request) {
  }
  const first = providerCalls++ === 0
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = first
    ? {
        tool_calls: [
          {
            index: 0,
            id: 'ui-coding',
            type: 'function',
            function: {
              name: 'coding_command',
              arguments: JSON.stringify({
                command: 'node --version',
                cwd: '.',
                purpose: 'runtime',
                timeoutSeconds: 10,
              }),
            },
          },
        ],
      }
    : { content: 'The runtime check completed.' }
  for (const [value, finish] of [
    [{ role: 'assistant' }, null],
    [delta, first ? 'tool_calls' : 'stop'],
  ])
    response.write(
      `data: ${JSON.stringify({ id: 'ui-provider', object: 'chat.completion.chunk', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`,
    )
  response.end('data: [DONE]\n\n')
})
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
const daemon = await startTestServer({
  LMSTUDIO_URL: `http://127.0.0.1:${provider.address().port}/v1`,
  BAZILION_BASH_SANDBOX: 'off',
  BAZILION_BASH_SANDBOX_IMAGE: 'bazilion-coding:node24-pnpm10',
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
  await page.getByText('Advanced repository diagnostics', { exact: true }).click()
  const card = page.getByRole('region', { name: 'Explore the repository', exact: true })
  await card.getByRole('heading', { name: /Instructions · [12] files/ }).waitFor()
  await card
    .locator('summary')
    .filter({ hasText: /^AGENTS.md$/ })
    .click()
  assert.equal(await page.evaluate(() => window.__repoExecuted), undefined)
  const sourceDetails = card
    .locator('details')
    .filter({ has: page.getByText('Source details and fingerprints', { exact: true }) })
  assert.equal(await sourceDetails.getAttribute('open'), null)
  await card.screenshot({ path: join(evidence, 'desktop.png') })
  await card.getByLabel('Project path').fill('app/new.ts')
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
  await card.getByLabel('Project path').fill('../outside')
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await card.getByRole('heading', { name: /Instructions .*incomplete/ }).waitFor()
  assert((await card.textContent()).includes('../outside'))
  assert.equal(await card.getByRole('status').locator('li').count(), 1)
  assert.equal(await card.locator('pre').count(), 0)
  await card.getByLabel('Project path').fill('app/new.ts')
  assert((await card.textContent()).includes('../outside'))
  await card.screenshot({ path: join(evidence, 'incomplete.png') })
  await card.getByRole('button', { name: 'Refresh context', exact: true }).click()
  await card.getByRole('heading', { name: /Instructions · [12] files/ }).waitFor()
  assert((await card.textContent()).includes('app/new.ts'))
  await card
    .locator('summary')
    .filter({ hasText: /^app\/AGENTS.md$/ })
    .click()
  assert((await card.textContent()).includes('REFRESHED_ACCEPTANCE_SENTINEL'))
  await daemon.cli(['profile', 'create', 'ui-coder', '--model', 'lmstudio:test-model'])
  const spawned = await daemon.cli(['agent', 'spawn', '--profile', 'ui-coder'])
  const agentId = spawned.stdout.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  )?.[0]
  assert(agentId)
  await page.goto(`${url}/agents/${agentId}`)
  await page.getByPlaceholder('Write a message…').fill('Check the runtime for this task.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const result = page.getByLabel('Coding command result')
  await result
    .getByText('succeeded', { exact: true })
    .waitFor({ timeout: 20000 })
    .catch(async (error) => {
      writeFileSync(join(evidence, 'failed-chat.txt'), await page.locator('body').innerText())
      console.log(evidence)
      throw error
    })
  assert((await result.textContent()).includes('node --version'))
  assert.equal(await result.locator('details').getAttribute('open'), null)
  await result.getByText('Output and evidence', { exact: true }).click()
  assert(/v(?:24|26)\./.test(await result.locator('pre').textContent()))
  await result.screenshot({ path: join(evidence, 'chat-mobile.png') })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.screenshot({ path: join(evidence, 'chat-desktop.png') })
  assert.equal(providerCalls, 2)
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
  await new Promise((resolve) => provider.close(resolve))
}
