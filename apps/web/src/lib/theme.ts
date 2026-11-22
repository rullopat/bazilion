// The colour theme: system, light or dark. Stored in localStorage under 'baziu-theme', the key the
// pre-hydration script in __root.tsx reads on first paint. While the choice is 'system', the page
// follows the operating system's setting as it changes.

import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const STORAGE_KEY = 'baziu-theme'
const CHANGED = 'baziu-theme-change'

function readMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

function applyMode(mode: ThemeMode): void {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle(
    'dark',
    mode === 'dark' || (mode === 'system' && systemDark),
  )
}

/** Choose a theme for this browser: it applies at once, in every place that shows it. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage refused (private mode): the choice lasts until the page reloads.
  }
  applyMode(mode)
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: mode }))
}

/** The theme in use, kept in step with every other place that changes it. */
export function useThemeMode(): ThemeMode {
  // 'system' first so the server render and the first browser render agree; the pre-hydration
  // script has already applied the real theme to <html>.
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    setMode(readMode())
    const onChange = (event: Event) => setMode((event as CustomEvent<ThemeMode>).detail)
    window.addEventListener(CHANGED, onChange)
    return () => window.removeEventListener(CHANGED, onChange)
  }, [])

  useEffect(() => {
    if (mode !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyMode('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [mode])

  return mode
}
