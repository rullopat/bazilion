// The bar above every page: home, "Jump to", and three places: Attention (what needs you, with a
// live count), Manage (Agents, Teams, templates, skills) and Setup (models, tools, connections).
// Theme and Log out are in the session menu at the end. Agents and Teams themselves are reached
// through the workspace's list, not from here.

import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
  UserRound,
} from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useAttentionCount } from '../lib/attention-count'
import {
  type NotificationsState,
  turnNotificationsOff,
  turnNotificationsOn,
  useNotificationsState,
} from '../lib/desktop-notifications'
import { isTyping } from '../lib/shortcuts'
import { setThemeMode, THEME_MODES, type ThemeMode, useThemeMode } from '../lib/theme'
import { BaziuLogo } from './BaziuLogo'
import { JumpPalette } from './JumpPalette'
import { ShortcutsDialog } from './ShortcutsDialog'

/** The pages each place covers, for marking it as the current one. */
const MANAGE_PATHS = ['/agents', '/teams', '/templates', '/skills', '/usage']
const SETUP_PATHS = ['/config']

const under = (pathname: string, roots: readonly string[]) =>
  roots.some((root) => pathname === root || pathname.startsWith(`${root}/`))

const THEME_LABELS: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  system: { label: 'Same as this computer', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
}

export function TopBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // The shortcut is written as this machine's keyboard has it; known once the page runs.
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), [])
  const setupOnly = pathname === '/welcome'
  const { open: openAttention } = useAttentionCount()

  // ⌘K on macOS, Ctrl+K elsewhere; ? lists the shortcuts.
  useEffect(() => {
    if (setupOnly) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (
        !event.defaultPrevented &&
        event.key === '?' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTyping(event.target) &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setupOnly])

  const attentionActive = under(pathname, ['/attention'])

  return (
    <nav
      aria-label="Primary navigation"
      className="relative mx-auto flex w-full max-w-[1800px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-frost py-2.5"
    >
      <Link
        to="/"
        aria-label="Bazilion home"
        className="group flex min-w-0 items-center gap-2 rounded-lg text-charcoal transition-opacity hover:text-charcoal hover:opacity-80"
      >
        <BaziuLogo className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-[1.08]" />
        <span className="truncate font-display text-[1.35rem] tracking-[-0.02em]">bazilion</span>
      </Link>

      {!setupOnly && (
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Jump to an agent, team or page, or run an action"
          aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
          className="unstyled order-last flex h-9 min-w-0 basis-full items-center gap-2 rounded-[10px] border border-border bg-muted px-2.5 text-left text-sm text-mocha transition-colors hover:border-sapphire-light sm:order-none sm:ml-3 sm:max-w-sm sm:flex-1 sm:basis-60"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Jump to or do anything</span>
          <kbd className="hidden rounded-md border border-border bg-card px-1.5 py-px font-mono text-xs sm:inline">
            {mac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        {!setupOnly && (
          <>
            <Link
              to="/attention"
              aria-current={attentionActive ? 'page' : undefined}
              className={navButtonClass(attentionActive)}
            >
              <BellRing className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Attention</span>
              {openAttention > 0 && (
                <>
                  <span
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-xs font-semibold leading-4 text-primary-foreground"
                    aria-hidden="true"
                  >
                    {openAttention > 99 ? '99+' : openAttention}
                  </span>
                  <span className="sr-only">, {openAttention} open items</span>
                </>
              )}
            </Link>
            <PlaceLink to="/agents" label="Manage" icon={LayoutGrid} roots={MANAGE_PATHS} />
          </>
        )}
        {/* Setup stays reachable from the first run, which only it can finish. */}
        <PlaceLink to="/config" label="Setup" icon={Settings2} roots={SETUP_PATHS} />
        <SessionMenu />
      </div>

      <JumpPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      {shortcutsOpen && <ShortcutsDialog mac={mac} onClose={() => setShortcutsOpen(false)} />}
    </nav>
  )
}

function PlaceLink({
  to,
  label,
  icon: Icon,
  roots,
}: {
  to: '/agents' | '/config'
  label: string
  icon: typeof Sun
  roots: readonly string[]
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const active = under(pathname, roots)
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={navButtonClass(active)}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}

/** Theme, notifications and Log out: things about this browser rather than places to go. */
function SessionMenu() {
  const mode = useThemeMode()
  const notifications = useNotificationsState()
  const [error, setError] = useState<string | null>(null)

  async function logout() {
    setError(null)
    try {
      await api('/api/logout', { method: 'POST' })
      window.location.assign('/login')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <>
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="Theme, notifications and log out"
            title="Theme, notifications and log out"
            className="unstyled inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-mocha transition-colors hover:border-frost hover:bg-ivory hover:text-sapphire data-[state=open]:border-sapphire-light data-[state=open]:bg-sapphire-glow data-[state=open]:text-sapphire"
          >
            <UserRound className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <DropdownMenuPrimitive.Label className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
              Theme
            </DropdownMenuPrimitive.Label>
            <DropdownMenuPrimitive.RadioGroup
              value={mode}
              onValueChange={(value) => setThemeMode(value as ThemeMode)}
            >
              {THEME_MODES.map((option) => {
                const { label, icon: Icon } = THEME_LABELS[option]
                return (
                  <DropdownMenuPrimitive.RadioItem
                    key={option}
                    value={option}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
                  >
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <DropdownMenuPrimitive.ItemIndicator>
                      <Check className="size-4 text-sapphire" aria-hidden="true" />
                    </DropdownMenuPrimitive.ItemIndicator>
                  </DropdownMenuPrimitive.RadioItem>
                )
              })}
            </DropdownMenuPrimitive.RadioGroup>
            <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-border" />
            <NotificationsItem state={notifications} />
            <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-border" />
            <DropdownMenuPrimitive.Item
              onSelect={() => void logout()}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
            >
              <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
              Log out
            </DropdownMenuPrimitive.Item>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-40 m-0 mt-1 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          Could not log out: {error}
        </p>
      )}
    </>
  )
}

/**
 * Desktop notifications for this browser. Turning them on asks the browser's permission; a browser
 * that blocks them, or an address where it offers none, is said so instead.
 */
function NotificationsItem({ state }: { state: NotificationsState }) {
  const itemClass =
    'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:cursor-default data-[disabled]:opacity-70'
  const Icon = state === 'on' ? BellOff : Bell
  const label =
    state === 'on'
      ? 'Turn off desktop notifications'
      : state === 'off'
        ? 'Notify me on this computer'
        : 'Desktop notifications unavailable'
  const detail =
    state === 'on' || state === 'off'
      ? 'When an Agent waits for you and Bazilion is in the background.'
      : state === 'blocked'
        ? 'This browser blocks them for this site; allow them in its site settings.'
        : 'Browsers offer them on https:// addresses and on this computer only.'
  return (
    <DropdownMenuPrimitive.Item
      disabled={state === 'unsupported' || state === 'blocked'}
      onSelect={(event) => {
        if (state === 'on') turnNotificationsOff()
        else {
          // The menu stays open while the browser asks, so the answer shows here.
          event.preventDefault()
          void turnNotificationsOn()
        }
      }}
      className={itemClass}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </DropdownMenuPrimitive.Item>
  )
}

function navButtonClass(active: boolean): string {
  return `unstyled inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold transition-colors sm:px-2.5 ${
    active
      ? 'border-sapphire-light bg-sapphire-glow text-sapphire shadow-baziu-sm'
      : 'border-transparent text-mocha hover:border-frost hover:bg-ivory hover:text-sapphire'
  }`
}
