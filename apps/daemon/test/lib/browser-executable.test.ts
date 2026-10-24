// T04 — executable discovery ordering and display/mode resolution.
//
// Fixture-driven: these tests never depend on which browsers are installed on
// the developer machine, and never launch a browser.

import { expect, test } from 'vitest'
import {
  _resetBrowserVersionCacheForTest,
  type BrowserProbeEnvironment,
  bundledChromiumCandidate,
  installedBrowserCandidates,
  probeBrowserVersion,
  readCachedBrowserVersion,
  resolveBrowserExecutable,
  resolveBrowserMode,
  resolveDisplayAvailability,
} from '../../src/lib/browser/executable.ts'

const HOME = '/home/tester'
const CACHE = `${HOME}/.cache/ms-playwright`

function probes(overrides: Partial<BrowserProbeEnvironment> = {}): BrowserProbeEnvironment {
  return {
    platform: 'linux',
    env: {},
    homedir: HOME,
    isExecutableFile: () => false,
    exists: () => false,
    readdir: () => [],
    ...overrides,
  }
}

function executable(paths: string[]): (path: string) => boolean {
  const set = new Set(paths)
  return (path) => set.has(path)
}

test('installed candidate order is Chrome → Brave → Edge → Chromium', () => {
  const order = installedBrowserCandidates('linux').map((c) => c.name)
  const firstOf = (name: string) => order.indexOf(name)
  expect(firstOf('Google Chrome')).toBeLessThan(firstOf('Brave'))
  expect(firstOf('Brave')).toBeLessThan(firstOf('Microsoft Edge'))
  expect(firstOf('Microsoft Edge')).toBeLessThan(firstOf('Chromium'))
})

test('discovery picks the first installed candidate in order', () => {
  const all = installedBrowserCandidates('linux').map((c) => c.path)
  const picked = resolveBrowserExecutable(undefined, probes({ isExecutableFile: executable(all) }))
  expect(picked.ok).toBe(true)
  expect(picked.candidate?.path).toBe('/usr/bin/google-chrome')
  expect(picked.candidate?.source).toBe('installed')

  // Only Brave and Chromium present → Brave wins.
  const braveOnly = resolveBrowserExecutable(
    undefined,
    probes({ isExecutableFile: executable(all.filter((p) => /brave/.test(p))) }),
  )
  expect(braveOnly.candidate?.name).toBe('Brave')
})

test('no installed browser falls back to the highest full bundled Chromium', () => {
  const bundled = `${CACHE}/chromium-1243/chrome-linux/chrome`
  const result = resolveBrowserExecutable(
    undefined,
    probes({
      readdir: (p) =>
        p === CACHE ? ['chromium-1228', 'chromium-1243', 'chromium_headless_shell-1243'] : [],
      isExecutableFile: executable([bundled]),
    }),
  )
  expect(result.ok).toBe(true)
  expect(result.candidate).toMatchObject({ path: bundled, source: 'bundled' })
})

test('macOS discovery retains family order across system and per-user applications', () => {
  const all = installedBrowserCandidates('darwin', '/Users/operator')
  expect(all[0]?.path).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  expect(all[1]?.path).toBe(
    '/Users/operator/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  )
  const result = resolveBrowserExecutable(
    undefined,
    probes({
      platform: 'darwin',
      homedir: '/Users/operator',
      isExecutableFile: executable([all[1]?.path ?? '', all[2]?.path ?? '']),
    }),
  )
  expect(result.candidate?.name).toBe('Google Chrome')
  expect(result.candidate?.path).toBe(all[1]?.path)
})

test('macOS full bundled discovery uses the native architecture, never the headless shell', () => {
  const cache = '/Users/operator/Library/Caches/ms-playwright'
  const path = `${cache}/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  const mac = probes({
    platform: 'darwin',
    arch: 'arm64',
    homedir: '/Users/operator',
    readdir: () => ['chromium-1228', 'chromium_headless_shell-1228'],
    isExecutableFile: executable([path]),
  })
  expect(resolveBrowserExecutable(undefined, mac).candidate).toMatchObject({
    path,
    source: 'bundled',
  })
  expect(resolveBrowserExecutable(undefined, { ...mac, arch: 'x64' }).ok).toBe(false)
})

test('a headless shell is never substituted for a missing full browser', () => {
  const shell = `${CACHE}/chromium_headless_shell-1243/chrome-linux/headless_shell`
  const result = resolveBrowserExecutable(
    undefined,
    probes({
      readdir: (p) => (p === CACHE ? ['chromium_headless_shell-1243'] : []),
      isExecutableFile: executable([shell]),
    }),
  )
  expect(result.ok).toBe(false)
  expect(result.reasonCode).toBe('browser_not_found')
  expect(result.remedy).toMatch(/Install|BROWSER_EXECUTABLE_PATH/)
  expect(
    bundledChromiumCandidate(probes({ readdir: () => ['chromium_headless_shell-1'] })),
  ).toBeNull()
})

test('an explicitly invalid path fails instead of running another binary', () => {
  const rel = resolveBrowserExecutable('brave', probes({ isExecutableFile: executable(['brave']) }))
  expect(rel).toMatchObject({ ok: false, reasonCode: 'browser_invalid_executable' })

  const missing = resolveBrowserExecutable('/usr/bin/nope', probes())
  expect(missing).toMatchObject({ ok: false, reasonCode: 'browser_invalid_executable' })
})

test('an explicit valid path wins over installed discovery', () => {
  const result = resolveBrowserExecutable(
    '/opt/custom/chrome',
    probes({
      isExecutableFile: executable(['/opt/custom/chrome', '/usr/bin/brave-browser']),
    }),
  )
  expect(result.ok).toBe(true)
  expect(result.candidate).toMatchObject({
    path: '/opt/custom/chrome',
    source: 'configured',
    name: 'Google Chrome',
  })
})

test('display availability on Linux distinguishes X11, Wayland and headless', () => {
  expect(resolveDisplayAvailability(probes({ env: { DISPLAY: ':0' } }))).toBe('available')
  expect(
    resolveDisplayAvailability(
      probes({ env: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/u' } }),
    ),
  ).toBe('available')
  expect(resolveDisplayAvailability(probes({ env: { WAYLAND_DISPLAY: 'wayland-0' } }))).toBe(
    'unavailable',
  )
  expect(resolveDisplayAvailability(probes({ env: {} }))).toBe('unavailable')
})

test('unsupported platforms refuse to infer a desktop', () => {
  expect(resolveDisplayAvailability(probes({ platform: 'darwin' }))).toBe('unsupported')
  const auto = resolveBrowserMode('auto', probes({ platform: 'darwin' }))
  expect(auto.ok).toBe(false)
  expect(auto.reasonCode).toBe('browser_display_unavailable')
  expect(auto.remedy).toMatch(/explicitly/)
})

test('Quartz facts, not Unix display variables, select macOS auto mode', () => {
  for (const [availability, mode] of [
    ['available', 'headed'],
    ['unavailable', 'headless'],
  ] as const) {
    const mac = probes({
      platform: 'darwin',
      env: { DISPLAY: ':99', WAYLAND_DISPLAY: 'not-quartz', XDG_RUNTIME_DIR: '/tmp' },
      guiSession: () => availability,
    })
    expect(resolveDisplayAvailability(mac)).toBe(availability)
    expect(resolveBrowserMode('auto', mac)).toEqual({ ok: true, mode })
  }
  const unknown = probes({
    platform: 'darwin',
    guiSession: () => {
      throw new Error('denied')
    },
  })
  expect(resolveBrowserMode('auto', unknown)).toMatchObject({
    ok: false,
    reasonCode: 'browser_display_unavailable',
  })
})

test('a proven non-GUI macOS session refuses headed mode without fallback', () => {
  const mac = probes({ platform: 'darwin', guiSession: () => 'unavailable' })
  expect(resolveBrowserMode('headed', mac)).toMatchObject({
    ok: false,
    reasonCode: 'browser_display_unavailable',
  })
  expect(resolveBrowserMode('headless', mac)).toEqual({ ok: true, mode: 'headless' })
})

test('explicit headless does not query a GUI or infer that any site works', () => {
  const mac = probes({
    platform: 'darwin',
    guiSession: () => {
      throw new Error('must not probe')
    },
  })
  expect(resolveBrowserMode('headless', mac)).toEqual({ ok: true, mode: 'headless' })
})

test('explicit macOS headed mode permits a native launch without pretending auto detected a display', () => {
  const mac = probes({ platform: 'darwin', env: {} })
  expect(resolveDisplayAvailability(mac)).toBe('unsupported')
  expect(resolveBrowserMode('auto', mac)).toMatchObject({ ok: false })
  expect(resolveBrowserMode('headed', mac)).toEqual({ ok: true, mode: 'headed' })
  expect(resolveBrowserMode('headless', mac)).toEqual({ ok: true, mode: 'headless' })
  // This does not enable unsupported Windows process ownership.
  expect(resolveBrowserMode('headed', probes({ platform: 'win32', env: {} })).ok).toBe(false)
})

test('explicit headless always resolves; explicit headed needs a display', () => {
  expect(resolveBrowserMode('headless', probes({ env: {} }))).toMatchObject({ mode: 'headless' })
  expect(resolveBrowserMode('headed', probes({ env: { DISPLAY: ':0' } }))).toMatchObject({
    mode: 'headed',
  })
  const noDisplay = resolveBrowserMode('headed', probes({ env: {} }))
  expect(noDisplay.ok).toBe(false)
  expect(noDisplay.reasonCode).toBe('browser_display_unavailable')
})

test('auto resolves headed with a display, headless without, never silently switching', () => {
  expect(resolveBrowserMode('auto', probes({ env: { DISPLAY: ':0' } }))).toMatchObject({
    mode: 'headed',
  })
  expect(resolveBrowserMode('auto', probes({ env: {} }))).toMatchObject({ mode: 'headless' })
})

test('version observation is cached and bounded', async () => {
  _resetBrowserVersionCacheForTest()
  const result = await probeBrowserVersion(process.execPath)
  expect(result?.version).toBe(process.version)
  const cached = readCachedBrowserVersion(process.execPath)
  expect(cached?.observedAt).toBe(result?.observedAt)
  // Expired entries are dropped.
  expect(readCachedBrowserVersion(process.execPath, Date.now() + 6 * 60_000)).toBeNull()
  _resetBrowserVersionCacheForTest()
})
