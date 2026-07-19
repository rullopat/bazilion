import { Link } from '@tanstack/react-router'
import { BaziuLogo } from './BaziuLogo'
import { PawIcon } from './PawIcon'

export function Footer() {
  return (
    <footer className="mx-auto mt-14 flex w-full max-w-[1500px] shrink-0 flex-col items-center justify-between gap-3 border-t border-frost py-5 text-xs text-mocha-light sm:flex-row">
      <Link
        to="/"
        className="team inline-flex items-center gap-2 rounded-lg text-charcoal transition-opacity hover:text-charcoal hover:opacity-80"
      >
        <BaziuLogo className="h-6 w-6 transition-transform duration-300 team-hover:rotate-[-8deg]" />
        <span className="font-display text-sm tracking-[-0.01em]">bazilion</span>
      </Link>
      <span className="inline-flex items-center gap-1.5">
        dedicated to Baziu
        <PawIcon className="h-3 w-3 text-rose-baziu opacity-60" aria-hidden="true" />
      </span>
    </footer>
  )
}
