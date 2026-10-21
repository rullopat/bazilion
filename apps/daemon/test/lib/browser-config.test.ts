// T02 — browser config resolution, mode preference and executable setting.
//
// The point of these tests is the three-way mode distinction (explicit headed,
// explicit headless, unset/auto) and the "empty means discover" rule for the
// executable path. No browser process is launched.

import { expect, test } from 'vitest'
import {
  configuredBrowserExecutablePath,
  isBrowserEnabled,
  resolveBrowserConfig,
  resolveBrowserModePreference,
} from '../../src/lib/browser/config.ts'

test('browser tools default on', () => {
  expect(isBrowserEnabled({})).toBe(true)
  expect(isBrowserEnabled({ BROWSER_ENABLED: '' })).toBe(true)
  expect(isBrowserEnabled({ BROWSER_ENABLED: 'true' })).toBe(true)
  expect(isBrowserEnabled({ BROWSER_ENABLED: 'false' })).toBe(false)
  expect(isBrowserEnabled({ BROWSER_ENABLED: '0' })).toBe(false)
  expect(isBrowserEnabled({ BROWSER_ENABLED: 'no' })).toBe(false)
  expect(isBrowserEnabled({ BROWSER_ENABLED: 'off' })).toBe(false)
})

test('unset BROWSER_HEADLESS is auto, not a silent headless default', () => {
  expect(resolveBrowserModePreference({})).toBe('auto')
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: '' })).toBe('auto')
})

test('explicit BROWSER_HEADLESS booleans are preserved', () => {
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: 'true' })).toBe('headless')
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: '1' })).toBe('headless')
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: 'false' })).toBe('headed')
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: '0' })).toBe('headed')
  expect(resolveBrowserModePreference({ BROWSER_HEADLESS: 'off' })).toBe('headed')
})

test('resolveBrowserConfig carries the mode preference and executable path', () => {
  const explicit = resolveBrowserConfig({ BROWSER_HEADLESS: 'false' })
  expect(explicit.mode).toBe('headed')
  expect(explicit.executablePath).toBeUndefined()

  const auto = resolveBrowserConfig({})
  expect(auto.mode).toBe('auto')
  expect(auto.executablePath).toBeUndefined()
  expect(auto.allowPrivate).toBe(false)
  expect(auto.idleMs).toBe(900_000)
  expect(auto.maxSessions).toBe(4)
})

test('executable path is trimmed; empty/whitespace counts as unset', () => {
  expect(configuredBrowserExecutablePath({})).toBeUndefined()
  expect(configuredBrowserExecutablePath({ BROWSER_EXECUTABLE_PATH: '' })).toBeUndefined()
  expect(configuredBrowserExecutablePath({ BROWSER_EXECUTABLE_PATH: '   ' })).toBeUndefined()
  expect(configuredBrowserExecutablePath({ BROWSER_EXECUTABLE_PATH: ' /usr/bin/brave ' })).toBe(
    '/usr/bin/brave',
  )
  expect(
    resolveBrowserConfig({ BROWSER_EXECUTABLE_PATH: '/usr/bin/chromium' }).executablePath,
  ).toBe('/usr/bin/chromium')
})

test('invalid numeric limits fall back to defaults instead of zero', () => {
  const cfg = resolveBrowserConfig({ BROWSER_IDLE_MS: 'nope', BROWSER_MAX_SESSIONS: '-1' })
  expect(cfg.idleMs).toBe(900_000)
  expect(cfg.maxSessions).toBe(4)
})

test('status serialization carries no paths, URLs or CDP endpoint', () => {
  const status = {
    agentId: 'a1',
    enabled: true,
    availability: 'configured' as const,
    state: 'stopped' as const,
    profilePresent: true,
    selectedBrowser: { name: 'Brave', source: 'installed' as const, mode: 'headed' as const },
  }
  const keys = Object.keys(JSON.parse(JSON.stringify(status)))
  expect(keys).toEqual([
    'agentId',
    'enabled',
    'availability',
    'state',
    'profilePresent',
    'selectedBrowser',
  ])
  expect(JSON.stringify(status)).not.toMatch(/\/(home|Users|usr|var)\//)
  expect(JSON.stringify(status)).not.toMatch(/ws:\/\/|http:\/\//)
})
