// ThemeProvider + useColors / useThemeMode hooks.
//
// Resolves the active palette by combining the user's stored preference
// ('system' | 'light' | 'dark', kept in SecureStore under 'baziu-theme')
// with the OS-level useColorScheme(). useColors() returns the right
// palette; useThemeMode() returns [mode, setMode] for the toggle UI in
// settings.tsx.

import * as SecureStore from 'expo-secure-store'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { type ColorSchemeName, useColorScheme } from 'react-native'
import { type Colors, darkColors, lightColors, type ThemeMode } from './theme'

const STORAGE_KEY = 'baziu-theme'

type ThemeCtx = {
  mode: ThemeMode
  /** The resolved 'light' | 'dark' after applying mode + system pref. */
  resolved: 'light' | 'dark'
  colors: Colors
  setMode: (m: ThemeMode) => Promise<void>
}

const Ctx = createContext<ThemeCtx | null>(null)

function resolveScheme(mode: ThemeMode, system: ColorSchemeName): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  return system === 'dark' ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [mode, setModeState] = useState<ThemeMode>('system')

  // Hydrate from SecureStore on mount. Failure (no SecureStore on a host,
  // a wiped key, etc.) just leaves the default 'system'.
  useEffect(() => {
    let cancelled = false
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((v) => {
        if (cancelled) return
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m)
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, m)
    } catch {
      // Storage denied — preference is still applied for the session.
    }
  }, [])

  const resolved = resolveScheme(mode, system)
  const colors = resolved === 'dark' ? darkColors : lightColors

  return <Ctx.Provider value={{ mode, resolved, colors, setMode }}>{children}</Ctx.Provider>
}

export function useColors(): Colors {
  const ctx = useContext(Ctx)
  // Tolerate use outside the provider (e.g. error boundaries that render
  // before mount). Falling back to light keeps the screen visible.
  return ctx?.colors ?? lightColors
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => Promise<void>] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useThemeMode must be used inside ThemeProvider')
  return [ctx.mode, ctx.setMode]
}

export function useResolvedScheme(): 'light' | 'dark' {
  const ctx = useContext(Ctx)
  return ctx?.resolved ?? 'light'
}
