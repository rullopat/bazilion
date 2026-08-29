import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, MessageSquareText, UsersRound } from 'lucide-react'
import { BaziuLogo } from '../components/BaziuLogo'
import { PawIcon } from '../components/PawIcon'
import { ThemeToggle } from '../components/ThemeToggle'

export const Route = createFileRoute('/login')({
  // Failed form submissions return to this branded page with a specific,
  // actionable reason. The field stays optional for normal auth redirects.
  validateSearch: (
    search: Record<string, unknown>,
  ): { error?: 'token' | 'origin' } => ({
    error:
      search.error === 'token' || search.error === 'origin' ? search.error : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { error } = Route.useSearch()
  return (
    <main className="relative flex min-h-dvh items-center overflow-hidden bg-cream px-5 py-16 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 16% 12%, rgba(61,120,153,0.18), transparent 36rem), radial-gradient(circle at 88% 84%, rgba(196,135,138,0.13), transparent 32rem)',
        }}
      />
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-20">
        <section className="hidden lg:block">
          <div className="mb-8 flex items-center gap-3">
            <BaziuLogo className="h-12 w-12" />
            <span className="font-display text-3xl tracking-[-0.03em] text-charcoal">bazilion</span>
          </div>
          <h1 className="max-w-xl text-[3.4rem] leading-[0.98] tracking-[-0.035em]">
            Your agents, working as one thoughtful team.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-mocha">
            A private workspace for long-lived agents, shared context, and communication policies
            you can actually see and control.
          </p>
          <div className="mt-8 grid max-w-lg gap-3 sm:grid-cols-2">
            <LoginFeature icon={<MessageSquareText className="h-4 w-4" />} label="Persistent conversations" />
            <LoginFeature icon={<UsersRound className="h-4 w-4" />} label="Team-owned context" />
          </div>
        </section>

        <section className="w-full rounded-[24px] border border-frost bg-snow/95 p-7 shadow-baziu-lg backdrop-blur sm:p-9">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <BaziuLogo className="h-10 w-10" />
            <span className="font-display text-2xl text-charcoal">bazilion</span>
          </div>
          <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-sapphire-glow text-sapphire">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-3xl text-charcoal">Open Bazilion</h2>
          <p className="mt-2 text-sm leading-6 text-mocha-light">
            Use the fresh-install credential once, then a named device token for future sign-ins.
          </p>
          {error === 'token' && (
            <div className="err mt-5" role="alert">
              That credential was not accepted. On first run, use the bootstrap token from{' '}
              <code>auth.json</code>; afterward, use a named device token.
            </div>
          )}
          {error === 'origin' && (
            <div className="err mt-5" role="alert">
              Bazilion blocked the sign-in request because its browser origin was hidden. Reload
              this page and try again from the configured Bazilion address.
            </div>
          )}
          <form method="POST" action="/api/login" className="mt-6 text-left">
            <label htmlFor="token" className="block text-[0.85em] font-semibold text-mocha">
              Access token
            </label>
            <input
              type="password"
              id="token"
              name="token"
              // biome-ignore lint/a11y/noAutofocus: a single-input login page is the canonical case for autofocus.
              autoFocus
              required
              placeholder="Paste your token"
              className="mb-4"
            />
            <button type="submit" className="w-full">
              Open Bazilion
            </button>
          </form>
          <p className="mt-5 rounded-xl bg-ivory px-3 py-2.5 text-[0.78em] leading-relaxed text-mocha-light">
            Fresh install? Paste the bootstrap token from <code>auth.json</code>; it is accepted
            only until provider setup is complete and is exchanged for a bounded session. For
            later sign-ins, run <code>bazilion token create browser</code> on the server.
          </p>
        </section>
      </div>

      <footer className="absolute bottom-4 left-0 right-0 text-center text-xs text-mocha-light">
        dedicated to Baziu
        <PawIcon className="ml-1 inline-block h-3 w-3 align-[-1px] opacity-40" />
      </footer>
    </main>
  )
}

function LoginFeature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-frost bg-snow/70 px-3 py-2.5 text-sm font-semibold text-mocha shadow-baziu-sm">
      <span className="text-sapphire">{icon}</span>
      {label}
    </div>
  )
}
