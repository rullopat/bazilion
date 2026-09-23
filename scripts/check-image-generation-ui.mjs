// BAZ-059 local browser projection smoke. Run after pnpm build.
// Disposable home; synthetic result bytes; no model calls or provider credentials.
// This checks configuration, saved-image preview/download and narrow layout, NOT live generation.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedImageResultsForUi } from '../apps/cli/test/fixtures/image-results.ts'
import { findFreePort, startTestServer } from '../apps/cli/test/server-fixture.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const { chromium } = createRequire(new URL('../apps/daemon/package.json', import.meta.url))(
  'playwright',
)
const evidence = mkdtempSync(join(tmpdir(), 'baz059-ui-'))
const daemon = await startTestServer({
  BAZILION_BASH_SANDBOX: 'off',
  BAZILION_SCHEDULER: 'off',
  BAZILION_PUBLIC_ORIGIN: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
  BAZILION_IMAGE_GENERATION: undefined,
  BAZILION_IMAGE_MODEL: undefined,
  OPENROUTER_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
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
async function cli(args) {
  const result = await daemon.cli(args)
  assert.equal(result.exitCode, 0, result.stderr || result.stdout)
  return result.stdout
}
let browser
try {
  const deadline = Date.now() + 20000
  while (true) {
    try {
      if ((await fetch(`${url}/login`)).ok) break
    } catch {}
    assert(web.exitCode === null && Date.now() < deadline, 'Web did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await cli(['provider', 'models-set', 'lmstudio', 'test-model'])
  await cli(['agent', 'spawn', '--profile', 'default', '--name', 'image-demo'])
  await cli(['config', 'set', 'OPENROUTER_API_KEY', 'fixture-not-a-provider-key'])
  const credential = (await cli(['token', 'create', 'image-ui'])).match(/token:\s+([0-9a-f]+)/)?.[1]
  assert(credential)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${url}/login`)
  await page.getByLabel('Access token', { exact: true }).fill(credential)
  await page.getByRole('button', { name: 'Open Bazilion', exact: true }).click()
  await page.waitForURL((next) => !next.pathname.startsWith('/login'))
  await page.goto(`${url}/config/services`)
  await page.locator('summary').filter({ hasText: 'Image generation' }).click()
  for (const [label, value] of [
    ['Default image route / model', 'google/gemini-3.1-flash-image'],
    ['Image generation', 'on'],
  ]) {
    const field = page.getByLabel(label, { exact: true })
    await field.selectOption(value)
    const button = page
      .locator('form')
      .filter({ has: field })
      .getByRole('button', { name: 'save', exact: true })
    await button.focus()
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/config/fields/') && response.request().method() === 'PUT',
    )
    await button.press('Enter')
    assert.equal((await saved).status(), 200)
    await page.waitForTimeout(150)
  }
  await page.getByText(/^Ready: google\/gemini-3\.1-flash-image via OpenRouter/).waitFor()
  assert(
    (await cli(['config', 'list'])).includes('Ready: google/gemini-3.1-flash-image via OpenRouter'),
  )
  await page.screenshot({ path: join(evidence, 'config.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByText(/^Ready: google\/gemini-3\.1-flash-image via OpenRouter/).waitFor()
  assert.equal(
    await page.getByLabel('Default image route / model', { exact: true }).inputValue(),
    'google/gemini-3.1-flash-image',
  )
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Configuration overflow',
  )
  await page.screenshot({ path: join(evidence, 'config-narrow.png'), fullPage: true })

  // Both direct authentication choices are visible/configurable without calling either service.
  await cli(['config', 'set', 'OPENAI_API_KEY', 'fixture-direct-not-a-key'])
  assert.equal(
    (
      await fetch(`${daemon.url}/api/auth/openai`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          access: 'fixture-oauth-not-a-key',
          refresh: 'fixture-refresh',
          expires: Date.now() + 3600000,
        }),
      })
    ).status,
    200,
  )
  for (const [selection, label] of [
    ['openai:gpt-image-2', 'OpenAI API key'],
    ['openai-codex:gpt-image-2', 'ChatGPT/Codex login'],
  ]) {
    const field = page.getByLabel('Default image route / model', { exact: true })
    assert((await field.locator(`option[value="${selection}"]`).innerText()).includes(label))
    await field.selectOption(selection)
    const button = page
      .locator('form')
      .filter({ has: field })
      .getByRole('button', { name: 'save', exact: true })
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/config/fields/') && response.request().method() === 'PUT',
    )
    await button.focus()
    await button.press('Enter')
    assert.equal((await saved).status(), 200)
    await page
      .getByText(/Ready:/)
      .filter({ hasText: label })
      .waitFor()
    assert((await cli(['config', 'list'])).includes(`via ${label}`))
    await page.reload()
    assert.equal(
      await page.getByLabel('Default image route / model', { exact: true }).inputValue(),
      selection,
    )
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({
      path: join(evidence, `config-${selection.split(':')[0]}-narrow.png`),
      fullPage: true,
    })
  }

  // Automatic routing follows text enablement, not the credentials seeded above.
  await cli(['provider', 'disable', 'openai'])
  await cli(['provider', 'disable', 'openai-codex'])
  const automaticField = page.getByLabel('Default image route / model', { exact: true })
  await automaticField.selectOption('auto')
  const automaticSaved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/config/fields/') && response.request().method() === 'PUT',
  )
  await page
    .locator('form')
    .filter({ has: automaticField })
    .getByRole('button', { name: 'save', exact: true })
    .click()
  assert.equal((await automaticSaved).status(), 200)
  await page.getByText(/^Automatic images: enable OpenAI/).waitFor()
  await cli(['provider', 'enable', 'openai'])
  await page.reload()
  await page.getByText(/^Ready:.*via OpenAI API key/).waitFor()
  assert.equal(
    await page.getByLabel('Default image route / model', { exact: true }).inputValue(),
    'auto',
  )
  assert(
    (await cli(['config', 'list'])).includes('Automatic selection follows enabled text providers'),
  )
  await page.screenshot({ path: join(evidence, 'config-auto-api-narrow.png'), fullPage: true })
  await cli(['provider', 'enable', 'openai-codex'])
  await page.reload()
  await page.getByText(/^Automatic images: both OpenAI text providers/).waitFor()
  await cli(['provider', 'disable', 'openai'])
  await page.reload()
  await page.getByText(/^Ready:.*via ChatGPT\/Codex login/).waitFor()
  assert.equal(
    await page.getByLabel('Default image route / model', { exact: true }).inputValue(),
    'auto',
  )
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: join(evidence, 'config-auto-codex-narrow.png'), fullPage: true })

  // Seed known Results only: image generation itself is exercised by the daemon's adapter tests.
  const { png, privateResultId } = seedImageResultsForUi(daemon.home)
  for (const [width, height] of [
    [1280, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${url}/teams/default/results`)
    assert.equal(new URL(page.url()).pathname, '/teams/default/results')
    const card = page
      .getByRole('region', { name: 'Saved result' })
      .filter({ hasText: 'image-version-1.png' })
    assert((await card.innerText()).includes('Generated via OpenAI API key'))
    assert(
      (
        await page
          .getByRole('region', { name: 'Saved result' })
          .filter({ hasText: 'image-version-2.png' })
          .innerText()
      ).includes('Generated via ChatGPT/Codex login'),
    )
    await card.getByRole('button', { name: 'Preview', exact: true }).click()
    const image = card.getByRole('img', { name: 'image-version-1.png' })
    await image.waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('img')].some(
        (img) => img.alt === 'image-version-1.png' && img.naturalWidth > 0,
      ),
    )
    const download = page.waitForEvent('download')
    await card.getByRole('button', { name: 'Download', exact: true }).click()
    const file = await download
    const destination = join(evidence, `download-${width}.png`)
    await file.saveAs(destination)
    assert.deepEqual(readFileSync(destination), png)
    assert.equal(await page.getByText('image-version-3.png', { exact: true }).count(), 0)
    assert.equal(
      (await page.request.get(`${url}/api/results/${privateResultId}/preview`)).status(),
      404,
    )
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Horizontal overflow',
    )
    await page.screenshot({ path: join(evidence, `results-${width}.png`), fullPage: true })
  }
  assert.deepEqual(errors, [])
  writeFileSync(
    join(evidence, 'summary.json'),
    JSON.stringify(
      {
        scope: 'configuration/result projection only; synthetic images; no model request',
        viewports: [1280, 390],
        sha256: createHash('sha256').update(png).digest('hex'),
        pageErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log(`BAZ-059 browser projection smoke passed: ${evidence}`)
} finally {
  await browser?.close()
  if (web.exitCode === null) {
    const exited = new Promise((resolve) => web.once('exit', resolve))
    web.kill('SIGTERM')
    await exited
  }
  await daemon.stop()
}
