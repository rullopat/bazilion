// Which browser binary to launch: BROWSER_EXECUTABLE_PATH when set, otherwise
// the first installed Chrome, Brave, Edge or Chromium, otherwise a full
// Chromium in Playwright's browser cache, which `install.ts` fills when
// nothing else is found.

import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

export interface BrowserExecutable {
  path: string
  name: string
}

export const NO_BROWSER_FOUND =
  'No browser found: install Chrome, Brave, Edge or Chromium, or set BROWSER_EXECUTABLE_PATH.'

const LINUX_INSTALLED: BrowserExecutable[] = [
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

// A macOS app bundle and the binary inside it share a name.
const MAC_APPS: Array<{ app: string; name: string }> = [
  { app: 'Google Chrome', name: 'Google Chrome' },
  { app: 'Brave Browser', name: 'Brave' },
  { app: 'Microsoft Edge', name: 'Microsoft Edge' },
  { app: 'Chromium', name: 'Chromium' },
]

/** The usual install paths on `platform`; on macOS, in /Applications then ~/Applications. */
export function installedBrowserPaths(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): BrowserExecutable[] {
  if (platform !== 'darwin') return LINUX_INSTALLED
  return ['/Applications', join(home, 'Applications')].flatMap((root) =>
    MAC_APPS.map(({ app, name }) => ({
      path: join(root, `${app}.app`, 'Contents', 'MacOS', app),
      name,
    })),
  )
}

// Where Playwright has put the binary inside a `chromium-<revision>` directory.
const BUNDLED_LAYOUTS = [
  ['chrome-linux64', 'chrome'],
  ['chrome-linux', 'chrome'],
  ...['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac'].flatMap((dir) =>
    ['Google Chrome for Testing', 'Chromium'].map((app) => [
      dir,
      `${app}.app`,
      'Contents',
      'MacOS',
      app,
    ]),
  ),
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

/** Playwright's browser cache: PLAYWRIGHT_BROWSERS_PATH, else its default for the platform. */
export function playwrightCacheDir(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  return (
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (platform === 'darwin'
      ? join(home, 'Library', 'Caches', 'ms-playwright')
      : join(home, '.cache', 'ms-playwright'))
  )
}

/** The newest full Chromium in Playwright's browser cache (never the headless shell). */
export function bundledChromium(root = playwrightCacheDir()): BrowserExecutable | null {
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
    for (const layout of BUNDLED_LAYOUTS) {
      const path = join(root, revision, ...layout)
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
  const found =
    installedBrowserPaths().find((candidate) => isExecutableFile(candidate.path)) ??
    bundledChromium()
  if (!found) throw new Error(NO_BROWSER_FOUND)
  return found
}
