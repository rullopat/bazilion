// Which browser binary to launch: BROWSER_EXECUTABLE_PATH when set, otherwise
// the first installed Chrome, Brave, Edge or Chromium, otherwise a full
// Chromium that Playwright already downloaded. Nothing is downloaded here.

import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

export interface BrowserExecutable {
  path: string
  name: string
}

const INSTALLED: BrowserExecutable[] = [
  { path: '/usr/bin/google-chrome', name: 'Google Chrome' },
  { path: '/usr/bin/google-chrome-stable', name: 'Google Chrome' },
  { path: '/opt/google/chrome/chrome', name: 'Google Chrome' },
  { path: '/usr/bin/brave-browser', name: 'Brave' },
  { path: '/usr/bin/brave', name: 'Brave' },
  { path: '/opt/brave.com/brave/brave-browser', name: 'Brave' },
  { path: '/snap/bin/brave', name: 'Brave' },
  { path: '/usr/bin/microsoft-edge', name: 'Microsoft Edge' },
  { path: '/usr/bin/microsoft-edge-stable', name: 'Microsoft Edge' },
  { path: '/opt/microsoft/msedge/microsoft-edge', name: 'Microsoft Edge' },
  { path: '/usr/bin/chromium', name: 'Chromium' },
  { path: '/usr/bin/chromium-browser', name: 'Chromium' },
  { path: '/snap/bin/chromium', name: 'Chromium' },
]

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The newest full Chromium in Playwright's browser cache (never the headless shell). */
export function bundledChromium(
  root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
): BrowserExecutable | null {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  const revisions = entries
    .filter((entry) => /^chromium-\d+$/.test(entry))
    .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)))
  for (const revision of revisions) {
    // Playwright has used both directory names for its Linux build.
    for (const dir of ['chrome-linux64', 'chrome-linux']) {
      const path = join(root, revision, dir, 'chrome')
      if (isExecutableFile(path)) return { path, name: 'Chromium (Playwright)' }
    }
  }
  return null
}

/** The browser to launch, or an error that says how to get one. */
export function findBrowserExecutable(configuredPath?: string): BrowserExecutable {
  if (configuredPath) {
    if (!isAbsolute(configuredPath) || !isExecutableFile(configuredPath)) {
      throw new Error(`BROWSER_EXECUTABLE_PATH is not an executable file: ${configuredPath}`)
    }
    return { path: configuredPath, name: basename(configuredPath) }
  }
  const found = INSTALLED.find((candidate) => isExecutableFile(candidate.path)) ?? bundledChromium()
  if (!found) {
    throw new Error(
      'No browser found: install Chrome, Brave, Edge or Chromium, or set BROWSER_EXECUTABLE_PATH.',
    )
  }
  return found
}
