import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const instruction = 'BAZ057_PACKED_TEAM_INSTRUCTIONS_8f2d1'

/** Real installed CLI/API/browser turns; no provider interception or platform simulation. */
export async function qualifyPortableChat({
  home,
  moduleRoot,
  daemonUrl,
  webUrl,
  agentId,
  finalText,
  runCli,
  runDoctor,
}) {
  const token = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).token
  const authorization = { authorization: `Bearer ${token}` }
  const jsonHeaders = { ...authorization, origin: daemonUrl, 'content-type': 'application/json' }
  const api = async (path, options = {}) => {
    const response = await fetch(`${daemonUrl}${path}`, {
      ...options,
      headers: options.method ? jsonHeaders : authorization,
      signal: AbortSignal.timeout(30_000),
    })
    assert.ok(response.ok, `${path}: HTTP ${response.status}`)
    return response
  }
  const checkFrames = (body, message) => {
    const frames = body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(
      frames.some((frame) => frame.kind === 'fatal'),
      false,
      body.slice(-1000),
    )
    const done = frames.find((frame) => frame.kind === 'done')
    assert.ok(done, 'no terminal completion')
    assert.ok(done.messages.some((m) => m.role === 'user' && m.content === message))
    assert.ok(done.messages.some((m) => m.role === 'assistant' && m.content === finalText))
    return frames.length
  }
  const apiTurn = async (message) => {
    const { selection } = await (await api(`/api/agents/${agentId}/conversations`)).json()
    const response = await api(`/api/agents/${agentId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, expectedSelection: selection }),
    })
    return checkFrames(await response.text(), message)
  }

  // Resolve from the installed distribution, never from the source workspace.
  const require = createRequire(join(moduleRoot, 'daemon-main.js'))
  const piVersions = {}
  for (const pkg of ['pi-ai', 'pi-agent-core', 'pi-coding-agent', 'pi-mcp']) {
    const name = `@earendil-works/${pkg}`
    // Pi's public entry points are import-only; CommonJS require.resolve rejects them.
    const metadataPath = findPackageJSON(name, pathToFileURL(join(moduleRoot, 'daemon-main.js')))
    assert.ok(
      metadataPath?.startsWith(`${dirname(moduleRoot)}${sep}`),
      `${name}: not installed locally`,
    )
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    assert.equal(metadata.name, name)
    assert.equal(metadata.version, '1.4.0', name)
    piVersions[name] = metadata.version
  }
  const manifest = require('@openclaw/fs-safe/package.json')
  assert.equal(manifest.version, '0.26.8')
  const { getFsSafeNativeStatus } = await import(
    pathToFileURL(require.resolve('@openclaw/fs-safe/config')).href
  )
  const native = await getFsSafeNativeStatus({ probe: true })
  const evidence = {
    platform: process.platform,
    node: process.version,
    fsSafeVersion: manifest.version,
    piVersions,
    native,
    api: [],
    cli: [],
    web: [],
  }
  const health = await (await api('/api/health/details')).json()
  assert.equal(health.ok, true)
  assert.equal(
    health.platformCapabilities.platform,
    process.platform === 'darwin' ? 'macOS' : 'Linux',
  )
  assert.deepEqual(
    health.platformCapabilities.capabilities.map((c) => [c.id, c.support]),
    [
      ['ordinary_chat', 'supported'],
      ['git_inspection', 'supported'],
      ['mcp_stdio', 'supported'],
      ['mcp_http', 'supported'],
    ],
  )
  if (process.platform === 'darwin') assert.equal(health.protectedWorkBaselineReady, false)
  const doctor = await runDoctor()
  assert.equal(doctor.code, 0, doctor.stderr)
  assert.ok(doctor.stdout.includes('install is healthy ✓'))
  assert.ok(doctor.stdout.includes('ordinary chat execution: not checked'))
  assert.ok(doctor.stdout.includes(`platform support: ${health.platformCapabilities.platform}`))
  assert.ok(
    doctor.stdout.includes(
      `protected unattended baseline: ${health.protectedWorkBaselineReady ? 'ready' : 'unavailable'}`,
    ),
  )
  evidence.diagnostics = {
    installHealthy: health.ok,
    platformCapabilities: health.platformCapabilities,
    protectedWorkBaselineReady: health.protectedWorkBaselineReady,
    doctorExit: doctor.code,
    viewports: [],
  }
  const { chromium } = require('playwright')
  const browserPath = [
    process.env.BAZILION_INSTALLER_UI_BROWSER,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((path) => path && existsSync(path))
  assert.ok(browserPath, 'No existing UI browser; no download or fallback was attempted')
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route) => {
      const url = route.request().url()
      return url.startsWith(`${webUrl}/`) ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const device = await (
      await api('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({ label: 'portable-browser-smoke', expiresInDays: 1 }),
      })
    ).json()
    await page.goto(`${webUrl}/login`)
    await page.getByLabel('Access token', { exact: true }).fill(device.token)
    await Promise.all([
      page.waitForURL((url) => url.pathname !== '/login'),
      page.getByRole('button', { name: 'Open Bazilion', exact: true }).click(),
    ])
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${webUrl}/config`)
      const card = page.getByRole('region', {
        name: 'Installation and platform support',
        exact: true,
      })
      await card.waitFor({ state: 'visible' })
      const content = await card.innerText()
      assert.ok(content.includes(`Daemon platform: ${health.platformCapabilities.platform}`))
      assert.ok(content.includes('Not checked'))
      assert.ok(
        content.includes(
          health.protectedWorkBaselineReady ? 'Ready · per-turn checks still apply' : 'Unavailable',
        ),
      )
      for (const capability of health.platformCapabilities.capabilities) {
        const row = card.getByText(capability.label, { exact: true }).locator('..')
        assert.ok(
          (await row.innerText()).includes(
            `${capability.support === 'supported' ? 'Supported' : 'Unsupported'} on this platform`,
          ),
        )
        assert.ok((await row.innerText()).includes(capability.detail))
      }
      assert.equal(
        await card.evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      )
      assert.deepEqual(errors, [])
      evidence.diagnostics.viewports.push({ width, rendered: true, overflow: false })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    let checkedQueueReadiness = false
    let chatRequests = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/agents/${agentId}/chat`
      )
        chatRequests++
    })
    const webTurn = async (message) => {
      const queuePattern = `${webUrl}/api/agents/${agentId}/queue?*`
      let releaseQueue
      const gate = new Promise((resolve) => {
        releaseQueue = resolve
      })
      const checkQueueReadiness = !checkedQueueReadiness
      if (checkQueueReadiness) {
        await page.route(queuePattern, async (route) => {
          await gate
          await route.continue()
        })
      }
      try {
        const loadingQueue = page.waitForRequest(
          (request) => new URL(request.url()).pathname === `/api/agents/${agentId}/queue`,
        )
        await page.goto(`${webUrl}/agents/${agentId}`)
        await loadingQueue
        const composer = page.getByPlaceholder('Write a message…')
        await composer.waitFor({ state: 'visible' })
        if (checkQueueReadiness) {
          // Deterministically reproduce the pre-dispatch refusal. This is not a
          // retry: no chat request may leave the browser and the draft must stay.
          const probe = 'BAZ071 queue initialization draft'
          const before = chatRequests
          assert.equal(await composer.locator('..').getAttribute('aria-busy'), 'true')
          await composer.fill(probe)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await page
            .getByText('Queue status is loading. Your draft is preserved.', { exact: true })
            .waitFor({ state: 'visible' })
          assert.equal(chatRequests, before)
          assert.equal(await composer.inputValue(), probe)
          evidence.diagnostics.queueReadiness = {
            preDispatchRefusal: true,
            chatRequests: 0,
            draftPreserved: true,
          }
          checkedQueueReadiness = true
        }
      } finally {
        releaseQueue()
        // Wait for held route handlers to finish before unregistering them;
        // plain unroute can race their continuation under runner contention.
        if (checkQueueReadiness) await page.unrouteAll({ behavior: 'wait' })
      }
      // A visible SSR textarea is not a ready composer. Wait for the real
      // client queue state, then submit this new trial exactly once.
      const composer = page.locator('form[aria-busy="false"]').getByPlaceholder('Write a message…')
      await composer.waitFor({ state: 'visible' })
      const previous = await page.getByText(finalText, { exact: true }).count()
      await composer.fill(message)
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/agents/${agentId}/chat`,
      )
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const response = await responsePromise
      assert.equal(response.status(), 200)
      const count = checkFrames(await response.text(), message)
      await page.getByText(finalText, { exact: true }).nth(previous).waitFor({ state: 'visible' })
      assert.deepEqual(errors, [])
      return count
    }
    evidence.api.push({ team: 'empty', frames: await apiTurn('BAZ057 empty API trial') })
    evidence.web.push({ team: 'empty', frames: await webTurn('BAZ057 empty web trial') })
    writeFileSync(join(home, 'teams', 'default', 'AGENTS.md'), `${instruction}\n`)
    const cli = await runCli('BAZ057 instructed CLI trial')
    assert.equal(cli.code, 0, cli.stderr)
    assert.ok(cli.stdout.includes(finalText))
    evidence.cli.push({ team: 'instructed', completed: true })
    evidence.api.push({ team: 'instructed', frames: await apiTurn('BAZ057 instructed API trial') })
    evidence.web.push({ team: 'instructed', frames: await webTurn('BAZ057 instructed web trial') })
    return evidence
  } finally {
    await browser.close()
  }
}

export const PORTABLE_CHAT_INSTRUCTION = instruction
