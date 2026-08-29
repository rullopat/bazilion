import type { AttentionSummary } from '@bazilion/api-types'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  BellRing,
  Bot,
  ChevronDown,
  LayoutTemplate,
  LogOut,
  MessageCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { useEffect, useState } from 'react'
import { BaziuLogo } from './BaziuLogo'
import { ThemeToggle } from './ThemeToggle'

const PRIMARY_LINKS = [
  { to: '/', label: 'Chat', icon: MessageCircle },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/teams', label: 'Teams', icon: UsersRound },
] as const

const OPERATIONS_LINKS = [
  {
    href: '/approvals',
    label: 'Approvals',
    description: 'Decide whether one captured action may proceed.',
    icon: ShieldCheck,
  },
  {
    href: '/attention',
    label: 'Attention',
    description: 'Inspect failures, warnings, lessons, and open signals.',
    icon: BellRing,
  },
] as const

const MANAGE_LINKS = [
  {
    href: '/templates',
    label: 'Templates',
    description: 'Reusable Agent behavior and Team rosters.',
    icon: LayoutTemplate,
  },
  {
    href: '/skills',
    label: 'Skills',
    description: 'Prompt skills available to your agents.',
    icon: Sparkles,
  },
  {
    href: '/config',
    label: 'Setup',
    description: 'Providers, integrations, access, and services.',
    icon: Settings2,
  },
] as const

export function TopNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [attention, setAttention] = useState<AttentionSummary | null>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    if (pathname === '/login' || pathname === '/welcome') return
    const controller = new AbortController()
    fetch('/api/attention/summary', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: AttentionSummary | null) => setAttention(body))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
      })
    return () => controller.abort()
  }, [pathname])

  async function logout() {
    setLogoutError(null)
    try {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) throw new Error(`Log out failed (${response.status})`)
      window.location.assign('/login')
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <nav
      aria-label="Primary navigation"
      className="relative mx-auto grid w-full max-w-[1500px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-frost py-3 md:flex md:gap-2 md:py-4"
    >
      <Link
        to="/"
        aria-label="Bazilion home"
        className="logo team flex min-w-0 items-center gap-2 rounded-lg text-charcoal transition-opacity hover:text-charcoal hover:opacity-80"
      >
        <BaziuLogo className="logo-paw h-8 w-8 shrink-0 transition-transform duration-300 team-hover:rotate-[-8deg] team-hover:scale-[1.08]" />
        <span className="truncate font-display text-[1.35rem] tracking-[-0.02em]">
          bazilion
        </span>
      </Link>

      <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 md:col-auto md:row-auto md:ml-4 md:flex-1 md:overflow-visible md:pb-0">
        {PRIMARY_LINKS.map((link) => {
          const active =
            link.to === '/'
              ? pathname === '/'
              : pathname === link.to || pathname.startsWith(`${link.to}/`)
          const Icon = link.icon
          return (
            <Link
              key={link.to}
              to={link.to}
              aria-current={active ? 'page' : undefined}
              className={navButtonClass(active)}
            >
              <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
              <span>{link.label}</span>
            </Link>
          )
        })}

        <NavMenu
          label="Operations"
          compactLabel="Ops"
          icon={BellRing}
          links={OPERATIONS_LINKS}
          pathname={pathname}
          badge={attention?.openTotal ?? 0}
          itemBadges={{
            '/approvals': attention?.byKind.communication_approval ?? 0,
            '/attention': attention?.openTotal ?? 0,
          }}
        />
        <NavMenu
          label="Manage"
          icon={Settings2}
          links={MANAGE_LINKS}
          pathname={pathname}
          align="end"
        />
      </div>

      <div className="col-start-2 row-start-1 flex items-center gap-1 md:col-auto md:row-auto md:ml-auto">
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
          className="col-span-2 m-0 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger md:absolute md:right-0 md:top-[calc(100%+0.35rem)] md:z-50 md:shadow-baziu-md"
        >
          {logoutError}
        </p>
      )}
    </nav>
  )
}

interface NavMenuLink {
  href: string
  label: string
  description: string
  icon: typeof Bot
}

function NavMenu({
  label,
  compactLabel,
  icon: Icon,
  links,
  pathname,
  badge = 0,
  itemBadges = {},
  align = 'start',
}: {
  label: string
  compactLabel?: string
  icon: typeof Bot
  links: readonly NavMenuLink[]
  pathname: string
  badge?: number
  itemBadges?: Record<string, number>
  align?: 'start' | 'end'
}) {
  const active = links.some(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`),
  )

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className={navButtonClass(active)} aria-label={`${label} menu`}>
          <Icon className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
          <span className={compactLabel ? 'sm:hidden' : undefined}>{compactLabel ?? label}</span>
          {compactLabel && <span className="hidden sm:inline">{label}</span>}
          {badge > 0 && (
            <>
              <span
                className="size-2 shrink-0 rounded-full bg-danger sm:hidden"
                aria-label={`${badge} open items`}
              />
              <span className="hidden sm:inline-flex">
                <CountBadge value={badge} label={`${badge} open items`} />
              </span>
            </>
          )}
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-baziu-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenuPrimitive.Label className="px-2.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </DropdownMenuPrimitive.Label>
          {links.map((link) => {
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
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {link.label}
                      {(itemBadges[link.href] ?? 0) > 0 && (
                        <CountBadge
                          value={itemBadges[link.href] ?? 0}
                          label={`${itemBadges[link.href]} open ${link.label.toLowerCase()} items`}
                        />
                      )}
                    </span>
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
  )
}

function CountBadge({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-xs font-semibold leading-4 text-primary-foreground"
      aria-label={label}
    >
      {value > 99 ? '99+' : value}
    </span>
  )
}

function navButtonClass(active: boolean): string {
  return `unstyled inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-semibold transition-colors sm:px-2.5 ${
    active
      ? 'border-sapphire-light bg-sapphire-glow text-sapphire shadow-baziu-sm'
      : 'border-transparent text-mocha hover:border-frost hover:bg-ivory hover:text-sapphire'
  }`
}
