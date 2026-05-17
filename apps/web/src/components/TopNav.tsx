import { Link } from '@tanstack/react-router'
import { PawIcon } from './PawIcon'

const NAV_LINKS = [
  { to: '/profiles', label: 'profiles' },
  { to: '/agents', label: 'agents' },
  { to: '/groups', label: 'groups' },
  { to: '/skills', label: 'skills' },
  { to: '/config', label: 'config' },
] as const

export function TopNav() {
  return (
    <nav className="flex flex-wrap items-center gap-y-1 gap-x-1 border-b border-frost py-5">
      <Link to="/" className="logo group mr-6 flex items-center gap-[0.45rem] text-charcoal">
        <PawIcon className="logo-paw h-[22px] w-[22px] opacity-55 transition-[opacity,transform] duration-300 group-hover:rotate-[-8deg] group-hover:scale-[1.08] group-hover:opacity-85" />
        <span className="font-display text-[1.35rem] tracking-[-0.02em]">bazilion</span>
      </Link>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="rounded-sm px-3 py-1.5 text-[0.92em] font-medium text-mocha transition-colors hover:bg-sapphire-glow hover:text-sapphire"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
