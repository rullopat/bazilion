import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
    const entry = require.resolve(name)
    assert.ok(entry.startsWith(`${dirname(moduleRoot)}${sep}`), `${name}: not installed locally`)
    const metadata = JSON.parse(readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8'))
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
    const webTurn = async (message) => {
      await page.goto(`${webUrl}/agents/${agentId}`)
      const composer = page.getByPlaceholder('Write a message…')
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
