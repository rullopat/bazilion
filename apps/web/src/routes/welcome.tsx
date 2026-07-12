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
          Before you can spawn agents, enable a provider and save at least one concrete model id.
          Once you do, a <code>default</code> profile (and a <code>default</code> team
          directory) are created automatically and the rest of the app unlocks.
        </p>
        <ol className="my-5 space-y-4">
          <Step n={1}>
            <strong>Choose a provider.</strong> Head to the{' '}
            <a href="/config">providers tab</a>, pick a provider, and set credentials or a local
            endpoint if that provider needs one. Local providers like Ollama and LM Studio can use
            their default loopback URLs.
          </Step>
          <Step n={2}>
            <strong>Enable it and save a model.</strong> Flip the provider's toggle on, then click
            a catalog chip or type one exact model id (for example{' '}
            <code>claude-opus-4-8</code>, <code>gpt-5.6-luna</code>, or <code>llama3.3</code>) and
            press <em>save models</em>.
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
