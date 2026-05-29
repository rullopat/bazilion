import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchAuthState } from '../lib/auth'

export const Route = createFileRoute('/welcome')({
  beforeLoad: async () => {
    // The root middleware already redirected here when setup wasn't done.
    // If the user lands directly (or completed setup in another tab), bounce
    // to the homepage — no point lingering on the welcome screen.
    const auth = await fetchAuthState()
    if (auth.setupComplete) {
      throw redirect({ to: '/' })
    }
  },
  component: WelcomePage,
})

function WelcomePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card">
        <h1>Welcome to bazilion</h1>
        <p className="muted my-3">
          Before you can spawn agents, pick a provider and give it at least one model. Once you
          do, a <code>default</code> profile (and a <code>default</code> group directory) are
          created automatically and the rest of the app unlocks.
        </p>
        <ol className="my-5 space-y-4">
          <Step n={1}>
            <strong>Configure credentials.</strong> Head to the{' '}
            <a href="/config">providers tab</a> and set the API key or local URL for the service
            you want to use (Anthropic, OpenAI, Ollama, LMStudio, …).
          </Step>
          <Step n={2}>
            <strong>Enable the provider + add a model.</strong> Flip the provider's toggle on
            and list at least one concrete model name (e.g. <code>claude-opus-4-8</code> or{' '}
            <code>llama3.2</code>).
          </Step>
          <Step n={3}>
            <strong>Start chatting.</strong> You'll be redirected to the home page
            automatically, where a <code>default</code> profile is waiting for a first spawn.
          </Step>
        </ol>
        <a
          href="/config"
          className="inline-flex items-center gap-2 rounded-md bg-sapphire px-4 py-2 text-[0.92em] font-semibold text-snow no-underline transition-colors hover:bg-sapphire-deep"
        >
          Go to config →
        </a>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3 border-t border-frost pt-3 first:border-t-0 first:pt-0">
      <span className="text-center font-display text-xl text-sapphire">{n}</span>
      <div className="text-[0.92em] leading-relaxed text-mocha">{children}</div>
    </li>
  )
}
