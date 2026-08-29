import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { PageHeader, PageShell, SectionCard } from '../components/Page'
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
    <PageShell size="narrow">
      <PageHeader
        eyebrow="First run"
        title="Welcome to bazilion"
        description="Configure one model provider to prepare your defaults, then test it before the first conversation."
      />
      <SectionCard title="Three steps to your first conversation">
        <p className="text-sm leading-6 text-muted-foreground">
          Before you can spawn agents, enable a provider and save at least one concrete model id.
          Bazilion then creates a <code>default</code> Agent template and <code>default</code> Team.
          Send the small connection test before relying on that model.
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
            <code>claude-opus-5</code>, <code>gpt-5.6-sol</code>, or <code>llama3.3</code>) and
            press <em>save models</em>.
          </Step>
          <Step n={3}>
            <strong>Verify and spawn.</strong> Send the short real-model test. When setup is
            configured, the page gives you a direct action to spawn the first agent from the{' '}
            <code>default</code> template.
          </Step>
        </ol>
        <a
          href="/config"
          className="btn-primary no-underline"
        >
          Configure providers <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </SectionCard>
    </PageShell>
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
