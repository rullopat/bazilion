import { createFileRoute } from '@tanstack/react-router'
import { PawIcon } from '../components/PawIcon'

export const Route = createFileRoute('/login')({
  // Optional `?error=1` from a failed POST /api/login redirect — daemon sends
  // the user back here when the form token is invalid. We type it as fully
  // optional so the redirect from the root middleware doesn't have to pass a
  // search object.
  validateSearch: (search: Record<string, unknown>): { error?: '1' } => ({
    error: search.error === '1' ? '1' : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { error } = Route.useSearch()
  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-cream">
      {/* Soft radial glows — Baziu's signature warmth on the auth shell. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 15%, rgba(74,124,155,0.12), transparent 55%), radial-gradient(circle at 80% 85%, rgba(196,135,138,0.10), transparent 55%)',
        }}
      />
      <div className="relative w-full max-w-sm rounded-[16px] border border-frost bg-snow p-8 text-center shadow-baziu-md">
        <PawIcon className="mx-auto mb-3 h-11 w-11 text-sapphire opacity-70" />
        <h1 className="font-display text-[2rem] tracking-tight text-charcoal">bazilion</h1>
        {error && <div className="err mt-4">invalid token</div>}
        <form method="POST" action="/api/login" className="mt-6 text-left">
          <label htmlFor="token" className="block text-[0.85em] font-medium text-mocha">
            Token
          </label>
          <input
            type="password"
            id="token"
            name="token"
            // biome-ignore lint/a11y/noAutofocus: a single-input login page is the canonical case for autofocus.
            autoFocus
            required
            placeholder="paste from auth.json"
            className="mb-5"
          />
          <button type="submit" className="w-full">
            log in
          </button>
        </form>
        <p className="mt-5 text-[0.78em] leading-relaxed text-mocha-light">
          Your token is in <code>~/.bazilion/auth.json</code>
          <br />
          created on first <code>bazilion serve</code>
        </p>
      </div>
      <footer className="absolute bottom-4 left-0 right-0 text-center text-[0.78em] text-fawn">
        dedicated to Baziu
        <PawIcon className="ml-1 inline-block h-3 w-3 align-[-1px] opacity-40" />
      </footer>
    </main>
  )
}
