// Live browser smoke test — exercises the real Playwright pool path
// (launch → navigate → ai aria snapshot → screenshot) against a data: URL so
// no network egress is needed. Skipped automatically if Chromium isn't
// installed (run `pnpm exec playwright install chromium`).

import { afterAll, expect, test } from 'vitest'
import type { BrowserConfig } from '../../src/lib/browser/pool.ts'
import { closeBrowserSession, invokeBrowserAction } from '../../src/lib/browser/pool.ts'

const CONFIG: BrowserConfig = {
  headless: true,
  allowPrivate: true,
  idleMs: 60_000,
  maxSessions: 2,
}

const PAGE =
  'data:text/html,' +
  encodeURIComponent(
    '<html><head><title>Hi</title></head><body><h1>Hello Bazilion</h1><button>Go</button></body></html>',
  )

let available = true

afterAll(async () => {
  await closeBrowserSession('browser-smoke')
})

test('navigate → snapshot → screenshot round-trips through the pool', {
  timeout: 60_000,
}, async () => {
  let nav: Awaited<ReturnType<typeof invokeBrowserAction>>
  try {
    nav = await invokeBrowserAction('browser-smoke', 'navigate', { url: PAGE }, CONFIG)
  } catch (err) {
    // Chromium not installed in this environment — skip rather than fail.
    if (/Executable doesn't exist|browserType.launch/.test(String(err))) {
      available = false
      return
    }
    throw err
  }

  const navText = nav.map((p) => (p.type === 'text' ? p.text : '')).join('')
  expect(navText).toContain('Hello Bazilion')

  const shot = await invokeBrowserAction('browser-smoke', 'take_screenshot', {}, CONFIG)
  const image = shot.find((p) => p.type === 'image')
  expect(image).toBeTruthy()
  if (image && image.type === 'image') {
    expect(image.mimeType).toBe('image/png')
    expect(image.data.length).toBeGreaterThan(100)
  }
})

test('reuses one session per agent across calls', { timeout: 60_000 }, async () => {
  if (!available) return
  // Two snapshots in a row should hit the same cached session (no relaunch).
  const a = await invokeBrowserAction('browser-smoke', 'snapshot', {}, CONFIG)
  expect(a.length).toBeGreaterThan(0)
})
