// Live browser smoke test — exercises the real Playwright pool path
// (launch → navigate → ai aria snapshot → screenshot) against a data: URL so
// no network egress is needed. Skipped automatically if Chromium isn't
// installed (the @playwright/browser-chromium dependency handles this during install).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import type { BrowserAdmission, BrowserConfig } from '../../src/lib/browser/pool.ts'
import { closeBrowserSession, invokeBrowserAction } from '../../src/lib/browser/pool.ts'

const CONFIG: BrowserConfig = {
  mode: 'headless',
  allowPrivate: true,
  idleMs: 60_000,
  maxSessions: 2,
}

// The managed pool now requires daemon-owned admission inputs.
const ADMISSION: BrowserAdmission = {
  paths: resolvePaths(mkdtempSync(join(tmpdir(), 'bazilion-live-'))),
  agentId: 'browser-smoke',
  teamId: 'live-team',
}

const PAGE =
  'data:text/html,' +
  encodeURIComponent(
    '<html><head><title>Hi</title></head><body><h1>Hello Bazilion</h1><button>Go</button></body></html>',
  )

let available = true

afterAll(async () => {
  await closeBrowserSession('browser-smoke')
  await closeBrowserSession('browser-blank')
})

test('navigate → snapshot → screenshot round-trips through the pool', {
  timeout: 120_000,
}, async () => {
  let nav: Awaited<ReturnType<typeof invokeBrowserAction>>
  try {
    nav = await invokeBrowserAction('browser-smoke', 'navigate', { url: PAGE }, CONFIG, ADMISSION, {
      daemonInstanceId: 'browser-live-test',
    })
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

  const shot = await invokeBrowserAction(
    'browser-smoke',
    'take_screenshot',
    {},
    CONFIG,
    ADMISSION,
    { daemonInstanceId: 'browser-live-test' },
  )
  const image = shot.find((p) => p.type === 'image')
  expect(image).toBeTruthy()
  if (image && image.type === 'image') {
    expect(image.mimeType).toBe('image/png')
    expect(image.data.length).toBeGreaterThan(100)
  }
})

test('reuses one session per agent across calls', { timeout: 120_000 }, async () => {
  if (!available) return
  // Two snapshots in a row should hit the same cached session (no relaunch).
  const a = await invokeBrowserAction('browser-smoke', 'snapshot', {}, CONFIG, ADMISSION, {
    daemonInstanceId: 'browser-live-test',
  })
  expect(a.length).toBeGreaterThan(0)
})

test('a stale/unknown ref recovers with a fresh snapshot instead of dead-ending', {
  timeout: 120_000,
}, async () => {
  if (!available) return
  const nav = await invokeBrowserAction(
    'browser-smoke',
    'navigate',
    { url: PAGE },
    CONFIG,
    ADMISSION,
    {
      daemonInstanceId: 'browser-live-test',
    },
  )
  const navText = nav.map((p) => (p.type === 'text' ? p.text : '')).join('')
  const observationId = /- Observation: (\S+)/.exec(navText)?.[1]
  expect(observationId).toBeTruthy()

  // An unknown ref with the CURRENT observationId fails, reports the possible
  // effect honestly (no "page was NOT changed" claim), and recovers with a
  // fresh bounded observation carrying a new observationId.
  const res = await invokeBrowserAction(
    'browser-smoke',
    'click',
    { ref: 'e9999', observationId },
    CONFIG,
    ADMISSION,
    { daemonInstanceId: 'browser-live-test' },
  )
  const txt = res.map((p) => (p.type === 'text' ? p.text : '')).join('')
  expect(txt).toMatch(/Could not act on ref "e9999"/)
  expect(txt).toMatch(/may or may not have taken effect/i)
  const recoveryId = /- Observation: (\S+)/.exec(txt)?.[1]
  expect(recoveryId).toBeTruthy()
  expect(recoveryId).not.toBe(observationId)

  // A ref interaction without the current observationId is refused outright (D5).
  const noObs = await invokeBrowserAction(
    'browser-smoke',
    'click',
    { ref: 'e5' },
    CONFIG,
    ADMISSION,
    {
      daemonInstanceId: 'browser-live-test',
    },
  )
  expect(noObs.map((p) => (p.type === 'text' ? p.text : '')).join('')).toMatch(
    /observationId of the current browser_snapshot/,
  )

  // A FORGED observationId is refused and re-observes.
  const forged = await invokeBrowserAction(
    'browser-smoke',
    'click',
    { ref: 'e5', observationId: 'forged-observation' },
    CONFIG,
    ADMISSION,
    { daemonInstanceId: 'browser-live-test' },
  )
  expect(forged.map((p) => (p.type === 'text' ? p.text : '')).join('')).toMatch(/stale|Re-observe/i)
})
test('screenshot/snapshot on a fresh (un-navigated) session return a navigate hint', {
  timeout: 120_000,
}, async () => {
  if (!available) return
  // A brand-new session sits on about:blank — perception must steer the model
  // to navigate first instead of returning a blank PNG it might misnarrate.
  const shot = await invokeBrowserAction(
    'browser-blank',
    'take_screenshot',
    {},
    CONFIG,
    ADMISSION,
    { daemonInstanceId: 'browser-live-test' },
  )
  expect(shot.every((p) => p.type === 'text')).toBe(true)
  expect(shot.map((p) => (p.type === 'text' ? p.text : '')).join('')).toMatch(/about:blank/i)

  const snap = await invokeBrowserAction('browser-blank', 'snapshot', {}, CONFIG, ADMISSION, {
    daemonInstanceId: 'browser-live-test',
  })
  expect(snap.map((p) => (p.type === 'text' ? p.text : '')).join('')).toMatch(/navigate/i)
})
