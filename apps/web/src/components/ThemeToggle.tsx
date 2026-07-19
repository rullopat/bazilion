// Tri-state theme toggle: system → light → dark → system.
// Persists to localStorage key 'baziu-theme' (same key the pre-hydration
// script in __root.tsx reads on first paint). When the choice is 'system',
// we also re-resolve against prefers-color-scheme on every OS-level change.

import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

type Mode = 'system' | 'light' | 'dark'
const STORAGE_KEY = 'baziu-theme'

const ICONS: Record<Mode, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const NEXT: Record<Mode, Mode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

function readMode(): Mode {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function applyMode(mode: Mode): void {
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = mode === 'dark' || (mode === 'system' && sysDark)
  document.documentElement.classList.toggle('dark', dark)
}

export function ThemeToggle() {
  // Start with 'system' so SSR + first client render agree; the pre-hydration
  // script has already applied the actual class to <html>, and the useEffect
  // below syncs state from localStorage immediately after mount.
  const [mode, setMode] = useState<Mode>('system')

  useEffect(() => {
    setMode(readMode())
  }, [])

  // Track OS-level changes while in 'system' mode.
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyMode('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const cycle = () => {
    const next = NEXT[mode]
    setMode(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    applyMode(next)
  }

  const Icon = ICONS[mode]
  const next = NEXT[mode]
  const label = `Theme: ${mode}. Switch to ${next}.`
  return (
    <button
      type="button"
      onClick={cycle}
      className="unstyled inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-frost bg-ivory px-2.5 text-mocha shadow-baziu-sm transition-all hover:border-sapphire-light hover:bg-sapphire-glow hover:text-sapphire active:translate-y-px"
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden text-xs font-medium capitalize xl:inline">{mode}</span>
    </button>
  )
}
