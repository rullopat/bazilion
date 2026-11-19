import { expect, test } from 'vitest'
import { isBrowserEnabled, resolveBrowserConfig } from '../../src/lib/browser/config.ts'

test('browser tools default on', () => {
  expect(isBrowserEnabled({})).toBe(true)
  expect(isBrowserEnabled({ BROWSER_ENABLED: '' })).toBe(true)
  expect(isBrowserEnabled({ BROWSER_ENABLED: 'true' })).toBe(true)
  for (const off of ['false', '0', 'no', 'off']) {
    expect(isBrowserEnabled({ BROWSER_ENABLED: off })).toBe(false)
  }
})

test('defaults: headless, discovery, SSRF proxy on, 15 min idle, 4 sessions', () => {
  expect(resolveBrowserConfig({})).toEqual({
    headless: true,
    allowPrivate: false,
    attach: false,
    idleMs: 900_000,
    maxSessions: 4,
  })
})

test('BROWSER_HEADLESS=false asks for a visible window', () => {
  expect(resolveBrowserConfig({ BROWSER_HEADLESS: 'false' }).headless).toBe(false)
  expect(resolveBrowserConfig({ BROWSER_HEADLESS: '0' }).headless).toBe(false)
  expect(resolveBrowserConfig({ BROWSER_HEADLESS: 'true' }).headless).toBe(true)
  expect(resolveBrowserConfig({ BROWSER_HEADLESS: '' }).headless).toBe(true)
})

test('the executable path is trimmed and blank means discovery', () => {
  expect(resolveBrowserConfig({ BROWSER_EXECUTABLE_PATH: '   ' }).executablePath).toBeUndefined()
  expect(resolveBrowserConfig({ BROWSER_EXECUTABLE_PATH: ' /usr/bin/brave ' }).executablePath).toBe(
    '/usr/bin/brave',
  )
})

test('invalid numeric limits fall back to the defaults', () => {
  const config = resolveBrowserConfig({ BROWSER_IDLE_MS: 'nope', BROWSER_MAX_SESSIONS: '-1' })
  expect(config.idleMs).toBe(900_000)
  expect(config.maxSessions).toBe(4)
})

test('BROWSER_ATTACH turns on the running browser, with an optional address', () => {
  expect(resolveBrowserConfig({ BROWSER_ATTACH: 'true' }).attach).toBe(true)
  expect(resolveBrowserConfig({ BROWSER_ATTACH: 'true' }).attachUrl).toBeUndefined()
  expect(
    resolveBrowserConfig({ BROWSER_ATTACH: 'true', BROWSER_ATTACH_URL: ' http://127.0.0.1:9222 ' })
      .attachUrl,
  ).toBe('http://127.0.0.1:9222')
  expect(resolveBrowserConfig({ BROWSER_ATTACH: 'off' }).attach).toBe(false)
})
