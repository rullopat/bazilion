import { afterEach, expect, test, vi } from 'vitest'
import { isStaleBuildError, reloadForNewBuild } from '../src/lib/stale-build'

afterEach(() => vi.unstubAllGlobals())

test('a part of the page that is gone from the server is told apart from other failures', () => {
  expect(
    isStaleBuildError(
      new TypeError(
        'Failed to fetch dynamically imported module: http://localhost:4322/assets/ConnectionsView-D7Fmutl2.js',
      ),
    ),
  ).toBe(true)
  expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true)
  expect(isStaleBuildError(new Error('daemon unreachable'))).toBe(false)
})

test('the page reloads for the new build once a minute at most', () => {
  const stored = new Map<string, string>()
  const reload = vi.fn()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    location: { reload },
  })
  expect(reloadForNewBuild(1_000_000)).toBe(true)
  // The file was missing after the reload too: the error page says so instead of looping.
  expect(reloadForNewBuild(1_030_000)).toBe(false)
  expect(reloadForNewBuild(1_070_000)).toBe(true)
  expect(reload).toHaveBeenCalledTimes(2)
})
