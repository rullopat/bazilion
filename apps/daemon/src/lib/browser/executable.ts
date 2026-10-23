// Deterministic browser executable discovery and display-mode resolution
// (BAZ-069 D2/T04).
//
// Explicit selection wins and is validated; an invalid explicit path fails
// rather than silently running a different binary. Otherwise discovery follows
// one fixed order: Chrome → Brave → Edge → Chromium installed executables, then
// an already-installed *full* bundled Chromium. A headless-shell substitute or a
// silent browser download is never used.
//
// All filesystem/environment/process access is injectable so the ordering and
// display rules are tested without depending on the developer machine's PATH or
// any particular browser being installed.

import { execFile } from 'node:child_process'
import { accessSync, constants, lstatSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { BrowserExecutableSource, BrowserMode, BrowserReasonCode } from '@bazilion/api-types'
import { probeDarwinGuiSession } from '../process/darwin-gui.ts'

export interface BrowserProbeEnvironment {
  platform: NodeJS.Platform
  arch?: string
  env: NodeJS.ProcessEnv
  homedir: string
  /** A regular, executable file at an absolute path. */
  isExecutableFile(path: string): boolean
  exists(path: string): boolean
  readdir(path: string): string[]
  /** Public Quartz-session facts; absent/unknown is not inferred from DISPLAY or a TTY. */
  guiSession?(): DisplayAvailability
}

export const realBrowserProbes: BrowserProbeEnvironment = {
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  homedir: homedir(),
  guiSession: probeDarwinGuiSession,
  isExecutableFile(path) {
    try {
      if (!lstatSync(path).isFile()) return false
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  exists(path) {
    try {
      return lstatSync(path).isFile() || lstatSync(path).isDirectory()
    } catch {
      return false
    }
  },
  readdir(path) {
    try {
      return readdirSync(path)
    } catch {
      return []
    }
  },
}

export type BrowserCandidateSource = BrowserExecutableSource

export interface BrowserCandidate {
  path: string
  name: string
  source: BrowserCandidateSource
}

function linuxCandidates(): BrowserCandidate[] {
  return [
    { path: '/usr/bin/google-chrome', name: 'Google Chrome', source: 'installed' },
    { path: '/usr/bin/google-chrome-stable', name: 'Google Chrome', source: 'installed' },
    { path: '/opt/google/chrome/chrome', name: 'Google Chrome', source: 'installed' },
    { path: '/usr/bin/brave-browser', name: 'Brave', source: 'installed' },
    { path: '/usr/bin/brave', name: 'Brave', source: 'installed' },
    { path: '/opt/brave.com/brave/brave-browser', name: 'Brave', source: 'installed' },
    { path: '/snap/bin/brave', name: 'Brave', source: 'installed' },
    { path: '/usr/bin/microsoft-edge', name: 'Microsoft Edge', source: 'installed' },
    { path: '/usr/bin/microsoft-edge-stable', name: 'Microsoft Edge', source: 'installed' },
    {
      path: '/opt/microsoft/msedge/microsoft-edge',
      name: 'Microsoft Edge',
      source: 'installed',
    },
    { path: '/usr/bin/chromium', name: 'Chromium', source: 'installed' },
    { path: '/usr/bin/chromium-browser', name: 'Chromium', source: 'installed' },
    { path: '/snap/bin/chromium', name: 'Chromium', source: 'installed' },
  ]
}

function darwinCandidates(home: string): BrowserCandidate[] {
  return (
    [
      ['Google Chrome', 'Google Chrome'],
      ['Brave Browser', 'Brave'],
      ['Microsoft Edge', 'Microsoft Edge'],
      ['Chromium', 'Chromium'],
    ] as const
  ).flatMap(([bundle, name]) =>
    ['/Applications', join(home, 'Applications')].map((directory) => ({
      path: join(directory, `${bundle}.app`, 'Contents', 'MacOS', bundle),
      name,
      source: 'installed' as const,
    })),
  )
}

function win32Candidates(): BrowserCandidate[] {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  return [
    {
      path: join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      name: 'Google Chrome',
      source: 'installed',
    },
    {
      path: join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      name: 'Google Chrome',
      source: 'installed',
    },
    {
      path: join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      name: 'Brave',
      source: 'installed',
    },
    {
      path: join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      name: 'Microsoft Edge',
      source: 'installed',
    },
    {
      path: join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      name: 'Microsoft Edge',
      source: 'installed',
    },
  ]
}

/** Installed candidates in deterministic order for the platform. */
export function installedBrowserCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): BrowserCandidate[] {
  if (platform === 'darwin') return darwinCandidates(home)
  if (platform === 'win32') return win32Candidates()
  return linuxCandidates()
}

function defaultBrowsersPath(probes: BrowserProbeEnvironment): string {
  const configured = probes.env.PLAYWRIGHT_BROWSERS_PATH
  if (configured && configured !== '0') return configured
  if (probes.platform === 'darwin') {
    return join(probes.homedir, 'Library', 'Caches', 'ms-playwright')
  }
  if (probes.platform === 'win32') {
    const local = probes.env.LOCALAPPDATA ?? join(probes.homedir, 'AppData', 'Local')
    return join(local, 'ms-playwright')
  }
  return join(probes.homedir, '.cache', 'ms-playwright')
}

function bundledExecutableIn(revisionDir: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return join(revisionDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
  }
  if (platform === 'win32') return join(revisionDir, 'chrome-win', 'chrome.exe')
  // Playwright's Linux layout has used both directory names across versions.
  return join(revisionDir, 'chrome-linux', 'chrome')
}

/**
 * The highest-revision already-installed *full* bundled Chromium, or null.
 * Deliberately ignores `chromium_headless_shell-*` and never downloads.
 */
export function bundledChromiumCandidate(probes: BrowserProbeEnvironment): BrowserCandidate | null {
  const root = defaultBrowsersPath(probes)
  const revisions = probes
    .readdir(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .map((name) => ({ name, revision: Number.parseInt(name.slice('chromium-'.length), 10) }))
    .filter((entry) => Number.isSafeInteger(entry.revision))
    .sort((a, b) => b.revision - a.revision)
  for (const entry of revisions) {
    const candidates = [
      bundledExecutableIn(join(root, entry.name), probes.platform),
      ...(probes.platform === 'darwin'
        ? [
            join(
              root,
              entry.name,
              `chrome-mac-${probes.arch ?? process.arch}`,
              'Google Chrome for Testing.app',
              'Contents',
              'MacOS',
              'Google Chrome for Testing',
            ),
          ]
        : [join(root, entry.name, 'chrome-linux64', 'chrome')]),
    ]
    for (const path of candidates) {
      if (probes.isExecutableFile(path)) {
        return { path, name: 'Chromium (bundled)', source: 'bundled' }
      }
    }
  }
  return null
}

export interface BrowserExecutableResult {
  ok: boolean
  candidate?: BrowserCandidate
  reasonCode?: BrowserReasonCode
  remedy?: string
}

/** Derive a safe display name from an operator-supplied binary name. */
export function displayNameForExecutablePath(path: string): string {
  const base = basename(path).toLowerCase()
  if (base.includes('chrome')) return 'Google Chrome'
  if (base.includes('brave')) return 'Brave'
  if (base.includes('edge') || base.includes('msedge')) return 'Microsoft Edge'
  if (base.includes('chromium')) return 'Chromium'
  return basename(path)
}

/**
 * Resolve the executable. `configuredPath` present means explicit selection:
 * it must be absolute and an executable regular file, or the result fails.
 */
export function resolveBrowserExecutable(
  configuredPath: string | undefined,
  probes: BrowserProbeEnvironment = realBrowserProbes,
): BrowserExecutableResult {
  if (configuredPath !== undefined && configuredPath !== '') {
    if (!isAbsolute(configuredPath)) {
      return {
        ok: false,
        reasonCode: 'browser_invalid_executable',
        remedy: 'BROWSER_EXECUTABLE_PATH must be an absolute path to an installed browser.',
      }
    }
    if (!probes.isExecutableFile(configuredPath)) {
      return {
        ok: false,
        reasonCode: 'browser_invalid_executable',
        remedy:
          'The configured browser path is not an executable file. Fix or clear ' +
          'BROWSER_EXECUTABLE_PATH to use automatic discovery.',
      }
    }
    return {
      ok: true,
      candidate: {
        path: configuredPath,
        name: displayNameForExecutablePath(configuredPath),
        source: 'configured',
      },
    }
  }

  for (const candidate of installedBrowserCandidates(probes.platform, probes.homedir)) {
    if (probes.isExecutableFile(candidate.path)) return { ok: true, candidate }
  }
  const bundled = bundledChromiumCandidate(probes)
  if (bundled) return { ok: true, candidate: bundled }

  return {
    ok: false,
    reasonCode: 'browser_not_found',
    remedy:
      'Install Chrome, Brave, Edge or Chromium, or set BROWSER_EXECUTABLE_PATH to an ' +
      'installed browser. Bazilion does not download a browser automatically.',
  }
}

// --- display / mode ---

export type DisplayAvailability = 'available' | 'unavailable' | 'unsupported'

export function resolveDisplayAvailability(
  probes: BrowserProbeEnvironment = realBrowserProbes,
): DisplayAvailability {
  if (
    probes.platform === 'linux' ||
    probes.platform === 'freebsd' ||
    probes.platform === 'openbsd'
  ) {
    if (probes.env.DISPLAY) return 'available'
    // A Wayland session needs its runtime dir to actually connect.
    if (probes.env.WAYLAND_DISPLAY && probes.env.XDG_RUNTIME_DIR) return 'available'
    return 'unavailable'
  }
  if (probes.platform === 'darwin') {
    try {
      return probes.guiSession?.() ?? 'unsupported'
    } catch {
      return 'unsupported'
    }
  }
  return 'unsupported'
}

export interface BrowserModeResult {
  ok: boolean
  mode?: BrowserMode
  reasonCode?: BrowserReasonCode
  remedy?: string
}

/**
 * Resolve the launch mode from the operator preference. An explicit headed
 * request on a proven-displayless Linux host fails — it never retries headless.
 */
export function resolveBrowserMode(
  preference: 'auto' | BrowserMode,
  probes: BrowserProbeEnvironment = realBrowserProbes,
): BrowserModeResult {
  if (preference === 'headless') return { ok: true, mode: 'headless' }
  if (preference === 'headed') {
    const display = resolveDisplayAvailability(probes)
    // Unknown Quartz evidence still permits an explicit native attempt, never an automatic
    // availability claim. Positively displayless sessions refuse; no headless fallback exists.
    if (display === 'available' || (probes.platform === 'darwin' && display === 'unsupported'))
      return { ok: true, mode: 'headed' }
    return {
      ok: false,
      reasonCode: 'browser_display_unavailable',
      remedy:
        'Headed mode was requested but no desktop display is available. Start the daemon ' +
        'in a desktop session or set BROWSER_HEADLESS=true.',
    }
  }
  const display = resolveDisplayAvailability(probes)
  if (display === 'available') return { ok: true, mode: 'headed' }
  if (display === 'unavailable') return { ok: true, mode: 'headless' }
  return {
    ok: false,
    reasonCode: 'browser_display_unavailable',
    remedy:
      'Cannot infer a desktop display on this platform. Set BROWSER_HEADLESS=true or ' +
      'false explicitly.',
  }
}

// --- bounded version observation ---

export interface CachedBrowserVersion {
  version: string
  observedAt: number
}

const VERSION_TTL_MS = 5 * 60_000
const versionCache = new Map<string, CachedBrowserVersion>()

export function readCachedBrowserVersion(
  path: string,
  now: number = Date.now(),
): CachedBrowserVersion | null {
  const entry = versionCache.get(path)
  if (!entry) return null
  if (now - entry.observedAt > VERSION_TTL_MS) {
    versionCache.delete(path)
    return null
  }
  return entry
}

/** Bounded (`--version`) probe. Failure is non-fatal: status may omit version. */
export function probeBrowserVersion(
  path: string,
  timeoutMs = 2_000,
): Promise<CachedBrowserVersion | null> {
  const cached = readCachedBrowserVersion(path)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const version = stdout.trim().split(/\s+/).pop() ?? ''
      const entry = { version, observedAt: Date.now() }
      if (version) versionCache.set(path, entry)
      resolve(version ? entry : null)
    })
  })
}

/** Test seam. */
export function _resetBrowserVersionCacheForTest(): void {
  versionCache.clear()
}
