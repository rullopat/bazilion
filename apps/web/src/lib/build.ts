// Which build of the web UI this page runs, and whether the server now runs another one. A tab
// left open across an upgrade keeps the page it loaded; the web server sends its build with every
// response (`x-bazilion-build`, set in src/start.ts), so the page can say "Bazilion was updated"
// and offer a reload, rather than show the old interface without a word.

import { useSyncExternalStore } from 'react'

// Replaced at build time (vite.config.ts); absent where Vite does not build the code (unit tests).
declare const __BAZILION_BUILD__: string | undefined

export const PAGE_BUILD: string =
  typeof __BAZILION_BUILD__ === 'string' ? __BAZILION_BUILD__ : 'dev'

export const BUILD_HEADER = 'x-bazilion-build'

let updated = false
const listeners = new Set<() => void>()

/** A response from the server: when it comes from another build, the page is out of date. */
export function noteServerBuild(build: string | null | undefined): void {
  if (updated || !build || build === PAGE_BUILD) return
  updated = true
  for (const listener of listeners) listener()
}

/** Whether the server has answered from a build other than this page's. */
export function isServerUpdated(): boolean {
  return updated
}

/** The same, as React state: true once it happens. */
export function useServerUpdated(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isServerUpdated,
    () => false,
  )
}

/** Test-only. */
export function _resetBuildForTest(): void {
  updated = false
}
