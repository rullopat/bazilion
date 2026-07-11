import { Link } from '@tanstack/react-router'
import { BaziuLogo } from './BaziuLogo'
import { ThemeToggle } from './ThemeToggle'

const NAV_LINKS = [
  { to: '/templates', label: 'templates' },
  { to: '/agents', label: 'agents' },
  { to: '/groups', label: 'groups' },
  { to: '/skills', label: 'skills' },
  { to: '/config', label: 'config' },
] as const

export function TopNav() {
  return (
    <nav className="flex flex-wrap items-center gap-y-1 gap-x-1 border-b border-frost py-5">
      <Link to="/" className="logo group mr-6 flex items-center gap-[0.45rem] text-charcoal">
        <BaziuLogo className="logo-paw h-[28px] w-[28px] transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-[1.08]" />
        <span className="font-display text-[1.35rem] tracking-[-0.02em]">bazilion</span>
      </Link>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="rounded-sm px-3 py-1.5 text-[0.92em] font-medium text-mocha transition-colors hover:bg-sapphire-glow hover:text-sapphire"
        >
          <span className="inline-flex items-center gap-1.5">{link.label}</span>
        </Link>
      ))}
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </nav>
  )
}
