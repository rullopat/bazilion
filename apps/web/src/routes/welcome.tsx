import {
  type Agent,
  DEFAULT_PROFILE_ID,
  type LocalProvidersResponse,
  type ProviderConfigEntry,
  type ProviderConfigResponse,
} from '@bazilion/api-types'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ArrowRight, Check, Monitor, Search } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '../components/Button'
import { PageShell } from '../components/Page'
import { ConnectedSummary, hostOf, ProviderChooser } from '../components/setup/AddProviderDialog'
import { type Connected, ProviderConnect } from '../components/setup/ProviderConnect'
import { ProviderAvatar } from '../components/setup/provider-parts'
import { api } from '../lib/api'
import { fetchAuthState } from '../lib/auth'
import { daemonClient } from '../lib/daemon-client'
import { usePageTitle } from '../lib/page-title'
import { useResource } from '../lib/use-resource'

const fetchProviders = createServerFn({ method: 'GET' }).handler(async () => {
  const { providers } = await daemonClient().get<ProviderConfigResponse>('/api/config/providers')
  return providers
})

export const Route = createFileRoute('/welcome')({
  beforeLoad: async () => {
    // The root route sends an installation without a working provider here. Once one works
    // (set up in another tab, or a reload after finishing), there is nothing left to do here.
    const auth = await fetchAuthState()
    if (auth.setupComplete) {
      throw redirect({ to: '/' })
    }
  },
  loader: () => fetchProviders(),
  component: WelcomePage,
})

type Step =
  | { at: 'choose' }
  | { at: 'local' }
  | { at: 'more' }
  | { at: 'connect'; id: string; from: 'choose' | 'local' | 'more' }
  | { at: 'done'; result: Connected }

const CARD = 'rounded-2xl border border-border bg-card shadow-baziu-sm'

/** First run: choose a provider, connect it, start chatting. One screen, no other page needed. */
function WelcomePage() {
  const providers = Route.useLoaderData()
  usePageTitle('Welcome')
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const [starting, setStarting] = useState(false)
  // The four most used get a tile of their own; the rest are a search away.
  const featured = providers.filter((provider) => provider.group === 'popular').slice(0, 4)
  const others = providers.filter(
    (provider) => provider.group !== 'local' && !featured.includes(provider),
  )
  const stage = step.at === 'done' ? 3 : step.at === 'connect' ? 2 : 1
  const connecting =
    step.at === 'connect' ? providers.find((provider) => provider.id === step.id) : undefined

  async function startChatting() {
    setStarting(true)
    try {
      // The first Agent comes from the Default template that the connect just made.
      const { agent } = await api<{ agent: Agent }>('/api/agents', {
        body: { profileId: DEFAULT_PROFILE_ID },
      })
      await navigate({ to: '/', search: { agent: agent.id } })
    } catch {
      // The workspace offers "Add the first Agent" and says what is wrong.
      await navigate({ to: '/' })
    }
  }

  return (
    <PageShell className="max-w-4xl">
      <header>
        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          First run
        </div>
        <h1 className="m-0 font-display text-4xl leading-tight text-foreground">
          Connect a model to start
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-6 text-muted-foreground">
          Bazilion needs one provider to think with. More providers, web search, the browser and
          Telegram can wait until you want them.
        </p>
      </header>

      <ol aria-label="Steps" className="flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
        {['Choose a provider', 'Connect', 'Start chatting'].map((name, index) => {
          const number = index + 1
          const done = number < stage
          const now = number === stage
          return (
            <li
              key={name}
              aria-current={now ? 'step' : undefined}
              className="flex items-center gap-2.5"
            >
              <span
                className={`flex size-7 items-center justify-center rounded-full border-[1.5px] text-sm font-bold ${
                  done
                    ? 'border-success bg-success text-white'
                    : now
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-fawn text-muted-foreground'
                }`}
              >
                {done ? <Check className="size-3.5" aria-label="Done" /> : number}
              </span>
              <span
                className={`text-sm font-semibold ${now ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {name}
              </span>
              {number < 3 && <span aria-hidden="true" className="h-px w-10 bg-fawn" />}
            </li>
          )
        })}
      </ol>

      {step.at === 'choose' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((provider) => (
            <Tile
              key={provider.id}
              icon={
                <ProviderAvatar name={provider.displayName} tone="accent" className="size-10" />
              }
              title={provider.connect === 'signin' ? 'ChatGPT account' : provider.displayName}
              sub={provider.hint ?? ''}
              foot={provider.connect === 'signin' ? 'Sign in' : 'Paste an API key'}
              onClick={() => setStep({ at: 'connect', id: provider.id, from: 'choose' })}
            />
          ))}
          <Tile
            icon={<Glyph icon={<Monitor className="size-5" />} />}
            title="On this computer"
            sub="Ollama, LM Studio or llama.cpp."
            foot="No account needed"
            onClick={() => setStep({ at: 'local' })}
          />
          <Tile
            icon={<Glyph icon={<Search className="size-5" />} />}
            title="Another provider"
            sub={`${others
              .slice(0, 3)
              .map((provider) => provider.displayName)
              .join(', ')} and ${others.length - 3} more.`}
            foot="Search"
            onClick={() => setStep({ at: 'more' })}
          />
        </div>
      )}

      {step.at === 'local' && (
        <LocalServers
          providers={providers}
          onBack={() => setStep({ at: 'choose' })}
          onUse={(id) => setStep({ at: 'connect', id, from: 'local' })}
        />
      )}

      {step.at === 'more' && (
        <section aria-label="Another provider" className={`${CARD} p-5`}>
          <StepHeader title="Another provider" onBack={() => setStep({ at: 'choose' })} />
          <ProviderChooser
            providers={others}
            expanded
            onPick={(provider) => setStep({ at: 'connect', id: provider.id, from: 'more' })}
          />
        </section>
      )}

      {step.at === 'connect' && connecting && (
        <section aria-label={`Connect ${connecting.displayName}`} className={`${CARD} p-5`}>
          <StepHeader
            title={`Connect ${connecting.displayName}`}
            icon={
              <ProviderAvatar name={connecting.displayName} tone="accent" className="size-10" />
            }
            onBack={() => setStep({ at: step.from })}
          />
          <div className="max-w-2xl">
            <ProviderConnect
              key={connecting.id}
              provider={connecting}
              onConnected={(result) => setStep({ at: 'done', result })}
            />
          </div>
        </section>
      )}

      {step.at === 'done' && (
        <section className={`${CARD} p-6`}>
          <ConnectedSummary result={step.result} imageRoutes={[]} />
          <p className="m-0 mt-3 pl-[3.75rem] text-sm text-muted-foreground">
            Bazilion made a Default team and a Default Agent template
            {step.result.provider.models[0] ? ` on ${step.result.provider.models[0]}` : ''}.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-frost pt-5">
            <Button
              variant="primary"
              disabled={starting}
              onClick={() => void startChatting()}
              className="min-h-12 px-6 text-base"
            >
              {starting ? 'Opening…' : 'Start chatting'}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <a href="/config?add=new" className="text-sm font-semibold">
              Add another provider
            </a>
            <span className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground sm:text-right">
              Web search, the browser and Telegram: later, under Manage, Setup.
            </span>
          </div>
        </section>
      )}
    </PageShell>
  )
}

function Glyph({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
    >
      {icon}
    </span>
  )
}

function Tile({
  icon,
  title,
  sub,
  foot,
  onClick,
}: {
  icon: ReactNode
  title: string
  sub: string
  foot: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CARD} flex min-h-36 flex-col items-start gap-2.5 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30`}
    >
      {icon}
      <span>
        <span className="block text-base font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{sub}</span>
      </span>
      <span className="mt-auto text-xs font-semibold text-primary">{foot}</span>
    </button>
  )
}

function StepHeader({
  title,
  icon,
  onBack,
}: {
  title: string
  icon?: ReactNode
  onBack: () => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {icon}
      <h2 className="m-0 min-w-0 flex-1 basis-48 font-display text-2xl text-foreground">{title}</h2>
      <Button variant="ghost" onClick={onBack}>
        Choose another
      </Button>
    </div>
  )
}

/** The model servers Bazilion found at their usual addresses on this machine. */
function LocalServers({
  providers,
  onBack,
  onUse,
}: {
  providers: ProviderConfigEntry[]
  onBack: () => void
  onUse: (id: string) => void
}) {
  const local = useResource(
    (signal) => api<LocalProvidersResponse>('/api/config/providers/local', { signal }),
    [],
  )
  const servers = local.data?.servers ?? []
  const found = servers.filter((server) => server.found).length
  return (
    <section aria-label="On this computer" className={`${CARD} overflow-hidden`}>
      <div className="px-5 pt-5">
        <StepHeader title="On this computer" onBack={onBack} />
        <p className="m-0 -mt-2 mb-4 text-sm text-muted-foreground">
          {local.loading
            ? 'Looking at the usual addresses…'
            : local.error
              ? local.error
              : found === 0
                ? 'No model server answered at the usual addresses.'
                : `Bazilion looked at the usual addresses and found ${found === 1 ? 'one server' : `${found} servers`}.`}
        </p>
      </div>
      {providers
        .filter((provider) => provider.group === 'local')
        .map((provider) => {
          const server = servers.find((entry) => entry.id === provider.id)
          return (
            <div
              key={provider.id}
              className="flex min-h-[4.5rem] flex-wrap items-center gap-3 border-t border-border px-5 py-3"
            >
              <ProviderAvatar
                name={provider.displayName}
                tone={server?.found ? 'success' : 'neutral'}
              />
              <div className="min-w-0 flex-1 basis-56">
                <div className="text-base font-semibold text-foreground">
                  {provider.displayName}
                </div>
                <div
                  className={`text-sm ${server?.found ? 'text-success' : 'text-muted-foreground'}`}
                >
                  {!server
                    ? 'Looking…'
                    : server.found
                      ? `Running at ${hostOf(server.address)}, with ${
                          server.models.length === 1 ? '1 model' : `${server.models.length} models`
                        }`
                      : `Nothing at ${hostOf(server.address)}. Start it and switch its server on.`}
                </div>
              </div>
              <Button
                variant={server?.found ? 'primary' : 'ghost'}
                onClick={() => onUse(provider.id)}
              >
                {server?.found ? `Use ${provider.displayName}` : 'Type its address'}
              </Button>
            </div>
          )
        })}
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/50 px-5 py-3">
        <span className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">
          These are the usual addresses on this computer. A server on another machine needs its
          address typed.
        </span>
        <Button variant="ghost" disabled={local.loading} onClick={() => void local.reload()}>
          {local.loading ? 'Looking…' : 'Look again'}
        </Button>
      </div>
    </section>
  )
}
