// The login page's theme button: system → light → dark → system. Signed in, the theme is chosen
// in the top bar's session menu instead.

import { Monitor, Moon, Sun } from 'lucide-react'
import { setThemeMode, type ThemeMode, useThemeMode } from '../lib/theme'

const ICONS: Record<ThemeMode, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }
const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }

export function ThemeToggle() {
  const mode = useThemeMode()
  const Icon = ICONS[mode]
  const next = NEXT[mode]
  const label = `Theme: ${mode}. Switch to ${next}.`
  return (
    <button
      type="button"
      onClick={() => setThemeMode(next)}
      className="unstyled inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-frost bg-ivory px-2.5 text-mocha shadow-baziu-sm transition-all hover:border-sapphire-light hover:bg-sapphire-glow hover:text-sapphire active:translate-y-px"
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden text-xs font-medium capitalize xl:inline">{mode}</span>
    </button>
  )
}
