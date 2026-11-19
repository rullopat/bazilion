import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test, vi } from 'vitest'
import {
  bundledChromium,
  findBrowserExecutable,
  installedBrowserPaths,
  playwrightCacheDir,
} from '../../src/lib/browser/executable.ts'

const root = mkdtempSync(join(tmpdir(), 'baz-browser-exe-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function executable(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
  return path
}

test('an explicit BROWSER_EXECUTABLE_PATH wins', () => {
  const path = executable(join(root, 'bin', 'my-browser'))
  expect(findBrowserExecutable(path)).toEqual({ path, name: 'my-browser' })
})

test('an explicit path that is not an executable file is an error, not a fallback', () => {
  const plain = join(root, 'plain-file')
  writeFileSync(plain, '')
  for (const bad of [plain, join(root, 'missing'), 'relative/chrome', root]) {
    expect(() => findBrowserExecutable(bad)).toThrow(/BROWSER_EXECUTABLE_PATH is not an executable/)
  }
})

test('the Playwright cache yields its newest full Chromium, never the headless shell', () => {
  const cache = join(root, 'ms-playwright')
  executable(join(cache, 'chromium-1200', 'chrome-linux', 'chrome'))
  const newest = executable(join(cache, 'chromium-1300', 'chrome-linux64', 'chrome'))
  executable(join(cache, 'chromium_headless_shell-1400', 'chrome-linux', 'headless_shell'))
  expect(bundledChromium(cache)).toEqual({ path: newest, name: 'Chromium (Playwright)' })
  expect(bundledChromium(join(root, 'no-cache'))).toBeNull()
})

test('macOS looks for app bundles, Linux for the usual binaries', () => {
  const mac = installedBrowserPaths('darwin', '/Users/me').map((browser) => browser.path)
  expect(mac[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  expect(mac).toContain('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
  expect(mac).toContain('/Users/me/Applications/Chromium.app/Contents/MacOS/Chromium')
  const linux = installedBrowserPaths('linux').map((browser) => browser.path)
  expect(linux[0]).toBe('/usr/bin/google-chrome')
  expect(linux.every((path) => !path.includes('.app/'))).toBe(true)
})

test('the Playwright cache is found on macOS too', () => {
  const cache = join(root, 'mac-cache')
  const mac = executable(
    join(
      cache,
      'chromium-1255',
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ),
  )
  expect(bundledChromium(cache)).toEqual({ path: mac, name: 'Chromium (Playwright)' })

  vi.stubEnv('PLAYWRIGHT_BROWSERS_PATH', '')
  try {
    expect(playwrightCacheDir('darwin', '/Users/me')).toBe('/Users/me/Library/Caches/ms-playwright')
    expect(playwrightCacheDir('linux', '/home/me')).toBe('/home/me/.cache/ms-playwright')
    vi.stubEnv('PLAYWRIGHT_BROWSERS_PATH', '/opt/browsers')
    expect(playwrightCacheDir('linux', '/home/me')).toBe('/opt/browsers')
  } finally {
    vi.unstubAllEnvs()
  }
})

test('the Chromium the bundled Playwright downloads is where the cache lookup expects it', async () => {
  // Playwright has moved the binary inside its cache directory before: a version that does so
  // again must fail here, not leave a downloaded Chromium unfound.
  const { chromium } = await import('playwright')
  const path = chromium.executablePath()
  const cache = join(root, 'playwright-layout')
  const revision = /[\\/](chromium-\d+)[\\/](.+)$/.exec(path)
  if (!revision?.[1] || !revision[2]) throw new Error(`unexpected Chromium path: ${path}`)
  const copy = executable(join(cache, revision[1], revision[2]))
  expect(bundledChromium(cache)).toEqual({ path: copy, name: 'Chromium (Playwright)' })
})
