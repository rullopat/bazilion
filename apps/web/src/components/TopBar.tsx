// The bar above every page: home, "Jump to", what needs attention, and the management pages.
// Agents and Teams are reached through the workspace's rail, not from here.

import type { AttentionSummary } from '@bazilion/api-types'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  BellRing,
  Bot,
  ChevronDown,
  LayoutTemplate,
  LogOut,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { BaziuLogo } from './BaziuLogo'
import { JumpPalette } from './JumpPalette'
import { ThemeToggle } from './ThemeToggle'

const MANAGE_LINKS = [
  {
    href: '/agents',
    label: 'Agents',
    description: 'Every Agent by Team: archive, move, delete.',
    icon: Bot,
  },
  {
    href: '/teams',
    label: 'Teams',
    description: 'Create a Team, or remove an empty one.',
    icon: UsersRound,
  },
  {
    href: '/templates',
    label: 'Templates',
    description: 'What new Agents start with, and Team rosters.',
    icon: LayoutTemplate,
  },
  {
    href: '/skills',
    label: 'Skills',
    description: 'Import, review and remove prompt skills.',
    icon: Sparkles,
  },
  {
    href: '/config',
    label: 'Setup',
    description: 'Models, tools, MCP, Telegram, access, system.',
    icon: Settings2,
  },
] as const

export function TopBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [attention, setAttention] = useState<AttentionSummary | null>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // The shortcut is written as this machine's keyboard has it; known once the page runs.
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), [])
  const setupOnly = pathname === '/welcome'

  useEffect(() => {
    if (pathname === '/login' || pathname === '/welcome') return
    const controller = new AbortController()
    api<AttentionSummary>('/api/attention/summary', { signal: controller.signal })
      .then(setAttention)
      .catch(() => {
        // The badge keeps its last count; the Attention page shows the error.
      })
    return () => controller.abort()
  }, [pathname])

  // ⌘K on macOS, Ctrl+K elsewhere.
  useEffect(() => {
    if (setupOnly) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setupOnly])

  const attentionActive = pathname === '/attention' || pathname.startsWith('/attention/')
  const openAttention = attention?.openTotal ?? 0
  const manageActive = MANAGE_LINKS.some(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`),
  )

  async function logout() {
    setLogoutError(null)
    try {
      await api('/api/logout', { method: 'POST' })
      window.location.assign('/login')
    } catch (error) {
      setLogoutError(errorMessage(error))
    }
  }

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
          aria-label="Jump to an agent, team or page"
          className="unstyled order-last flex h-9 min-w-0 basis-full items-center gap-2 rounded-[10px] border border-border bg-muted px-2.5 text-left text-sm text-mocha transition-colors hover:border-sapphire-light sm:order-none sm:ml-3 sm:max-w-sm sm:flex-1 sm:basis-60"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Jump to an agent, team or page</span>
          <kbd className="hidden rounded-md border border-border bg-card px-1.5 py-px font-mono text-[0.7rem] sm:inline">
            {mac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
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
        <DropdownMenuPrimitive.Root>
          <DropdownMenuPrimitive.Trigger asChild>
            <button type="button" className={navButtonClass(manageActive)} aria-label="Manage menu">
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Manage</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
              align="end"
              sideOffset={8}
              collisionPadding={12}
              className="z-50 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              {MANAGE_LINKS.map((link) => {
                const ItemIcon = link.icon
                const itemActive = pathname === link.href || pathname.startsWith(`${link.href}/`)
                return (
                  <DropdownMenuPrimitive.Item key={link.href} asChild>
                    <a
                      href={link.href}
                      aria-current={itemActive ? 'page' : undefined}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2.5 outline-none transition-colors focus:bg-accent focus:text-accent-foreground ${
                        itemActive ? 'bg-accent/70 text-accent-foreground' : 'text-foreground'
                      }`}
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <ItemIcon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{link.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {link.description}
                        </span>
                      </span>
                    </a>
                  </DropdownMenuPrimitive.Item>
                )
              })}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
        <ThemeToggle />
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Log out"
          title="Log out"
          className="unstyled inline-flex h-9 w-9 items-center justify-center rounded-lg text-mocha hover:bg-ivory hover:text-sapphire"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {logoutError && (
        <p
          role="alert"
          className="m-0 basis-full rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {logoutError}
        </p>
      )}
      <JumpPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </nav>
  )
}

function navButtonClass(active: boolean): string {
  return `unstyled inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold transition-colors sm:px-2.5 ${
    active
      ? 'border-sapphire-light bg-sapphire-glow text-sapphire shadow-baziu-sm'
      : 'border-transparent text-mocha hover:border-frost hover:bg-ivory hover:text-sapphire'
  }`
}
