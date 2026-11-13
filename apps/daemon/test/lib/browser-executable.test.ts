import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { bundledChromium, findBrowserExecutable } from '../../src/lib/browser/executable.ts'

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
