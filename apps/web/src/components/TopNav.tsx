import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bot,
  LayoutTemplate,
  BellRing,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { BaziuLogo } from './BaziuLogo'
import { ThemeToggle } from './ThemeToggle'
import { useEffect, useState } from 'react'

const NAV_LINKS = [
  { to: '/templates', label: 'templates', icon: LayoutTemplate },
  { to: '/agents', label: 'agents', icon: Bot },
  { to: '/teams', label: 'teams', icon: UsersRound },
  { to: '/approvals', label: 'approvals', icon: ShieldCheck },
  { to: '/attention', label: 'attention', icon: BellRing },
  { to: '/skills', label: 'skills', icon: Sparkles },
  { to: '/config', label: 'config', icon: Settings2 },
] as const

export function TopNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [attentionCount, setAttentionCount] = useState(0)
  useEffect(() => {
    if (pathname === '/login' || pathname === '/welcome') return
    fetch('/api/attention/summary')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setAttentionCount(body?.openTotal ?? 0))
      .catch(() => {})
  }, [pathname])

  return (
    <nav
      aria-label="Primary navigation"
      className="mx-auto grid w-full max-w-[1500px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-frost py-3 md:flex md:gap-2 md:py-4"
    >
      <Link
        to="/"
        aria-current={pathname === '/' ? 'page' : undefined}
        className="logo team flex min-w-0 items-center gap-2 rounded-lg text-charcoal transition-opacity hover:text-charcoal hover:opacity-80"
      >
        <BaziuLogo className="logo-paw h-8 w-8 shrink-0 transition-transform duration-300 team-hover:rotate-[-8deg] team-hover:scale-[1.08]" />
        <span className="truncate font-display text-[1.35rem] tracking-[-0.02em]">
          bazilion
        </span>
      </Link>

      <div className="col-span-2 row-start-2 flex min-w-0 items-center justify-between gap-1 md:col-auto md:row-auto md:ml-4 md:flex-1 md:justify-start">
        {NAV_LINKS.map((link) => {
          const active = pathname === link.to || pathname.startsWith(`${link.to}/`)
          const Icon = link.icon
          return (
            <Link
              key={link.to}
              to={link.to}
              aria-current={active ? 'page' : undefined}
              aria-label={link.label}
              title={link.label}
              className={`inline-flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg border px-2.5 text-sm font-medium transition-all md:min-w-10 lg:px-3 ${
                active
                  ? 'border-sapphire-light bg-sapphire-glow text-sapphire shadow-baziu-sm'
                  : 'border-transparent text-mocha hover:border-frost hover:bg-ivory hover:text-sapphire'
              }`}
            >
              <Icon className="h-[1.05rem] w-[1.05rem] shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">{link.label}</span>
              {link.to === '/attention' && attentionCount > 0 && (
                <span className="min-w-5 rounded-full bg-coral px-1.5 text-center text-xs text-white" aria-label={`${attentionCount} open attention items`}>
                  {attentionCount > 99 ? '99+' : attentionCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="col-start-2 row-start-1 md:col-auto md:row-auto md:ml-auto">
        <ThemeToggle />
      </div>
    </nav>
  )
}
