// A page left open across an upgrade runs the old build: the parts it loads on demand (the
// Connections map, a dialog) are named after that build and gone from the server, so loading one
// fails. Reloading the page gets the new build. It is tried once a minute at most: when the file
// is missing after a reload too, the error stays on screen and says so.

import { useEffect } from 'react'

const KEY = 'bz_stale_build_reload_at'
const ONCE_WITHIN_MS = 60_000

/** The browser could not load a part of the page's own build (a script or its styles). */
export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    message,
  )
}

/** Reload to get the new build, unless that was just tried; true when the page reloads. */
export function reloadForNewBuild(now = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) ?? 0)
    if (now - last < ONCE_WITHIN_MS) return false
    window.sessionStorage.setItem(KEY, String(now))
  } catch {
    // Without storage a reload could not tell it was tried: the error page offers it instead.
    return false
  }
  window.location.reload()
  return true
}

/** Reloads the page when Vite reports a part of the old build missing. */
export function StaleBuildReloader() {
  useEffect(() => {
    const onPreloadError = () => {
      reloadForNewBuild()
    }
    window.addEventListener('vite:preloadError', onPreloadError)
    return () => window.removeEventListener('vite:preloadError', onPreloadError)
  }, [])
  return null
}
