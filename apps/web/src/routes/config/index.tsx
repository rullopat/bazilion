import type {
  HealthReport,
  OpenAICodexStatus,
  ProviderConfigEntry,
  ProviderConfigResponse,
  ProviderTestResponse,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Search,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ConfigPage } from '../../components/ConfigPage'
import { ExecutionSecurityCard } from '../../components/ExecutionSecurityCard'
import { FieldRow } from '../../components/FieldRow'
import { EmptyState, StatusBadge } from '../../components/Page'
import { daemonClient } from '../../lib/daemon-client'
import {
  groupProviders,
  providerHasConfiguration,
  providerReadiness,
} from '../../lib/provider-presentation'

interface ProvidersData {
  providers: ProviderConfigEntry[]
  openaiCodex: OpenAICodexStatus
  executionSecurity: HealthReport['executionSecurity']
}

const fetchProvidersData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProvidersData> => {
    const c = daemonClient()
    const [{ providers }, openaiCodex, health] = await Promise.all([
      c.get<ProviderConfigResponse>('/api/config/providers'),
      c.get<OpenAICodexStatus>('/api/auth/openai'),
      c.get<HealthReport>('/api/health/details'),
    ])
    return { providers, openaiCodex, executionSecurity: health.executionSecurity }
  },
)

export const Route = createFileRoute('/config/')({
  loader: () => fetchProvidersData(),
  component: ProvidersPage,
})

function ProvidersPage() {
  const { providers, openaiCodex, executionSecurity } = Route.useLoaderData()
  const setupComplete = providers.some((p) => p.enabled && p.curated.length > 0)
  const startedComplete = useRef(setupComplete)
  const [showCompletion, setShowCompletion] = useState(false)
  const [query, setQuery] = useState('')
  const sections = useMemo(() => groupProviders(providers, query), [providers, query])
  const configured = providers.filter(providerHasConfiguration).length
  const enabled = providers.filter((provider) => provider.enabled).length

  useEffect(() => {
    if (!startedComplete.current && setupComplete) setShowCompletion(true)
  }, [setupComplete])

  return (
    <ConfigPage
      active="providers"
      title="Providers"
      description={
        <>
          Connect the model services your agents may use. Credentials stay encrypted;
          advanced endpoint and environment names remain available inside each provider.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Provider summary">
        <SummaryStat label="Configured" value={configured} detail="credentials, models, or toggle" />
        <SummaryStat label="Enabled" value={enabled} detail="available to agent runtime" />
        <SummaryStat
          label="Selected models"
          value={providers.reduce((count, provider) => count + (provider.enabled ? provider.curated.length : 0), 0)}
          detail="configured; test connectivity separately"
        />
      </div>

      <details className="rounded-2xl border border-border bg-card shadow-baziu-sm">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-foreground marker:hidden sm:px-5">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Execution security
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Inspect host and protected-turn posture
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </summary>
        <div className="border-t border-border p-3 sm:p-4">
          <ExecutionSecurityCard status={executionSecurity} />
        </div>
      </details>

      {!setupComplete && <SetupBlockerBanner providers={providers} openaiCodex={openaiCodex} />}

      {showCompletion && (
        <section
          role="status"
          className="rounded-2xl border border-success/30 bg-success/10 p-5 text-sm"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 font-body text-base font-semibold text-foreground">
                Your default workspace is ready
              </h2>
              <p className="mt-1 text-muted-foreground">
                Bazilion created the default Agent template and Team. Test the selected model
                below before relying on it, or continue to spawn your first agent.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="/agents" className="btn-primary no-underline">
                  Spawn your first agent
                  <ChevronRight className="size-4" aria-hidden="true" />
                </a>
                <Button variant="ghost" onClick={() => setShowCompletion(false)}>
                  Keep configuring
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-baziu-sm sm:p-5">
        <label htmlFor="provider-search" className="m-0 text-sm font-semibold text-foreground">
          Find a provider
        </label>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="provider-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by service, model, or advanced key"
            className="pl-9"
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Start with one provider. Everything else stays collapsed until you need it.
        </p>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          icon={<Search className="size-4" aria-hidden="true" />}
          title="No providers match"
          description={`Try another search instead of “${query}”.`}
          actions={<Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
        />
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <details
              key={`${section.key}:${query}`}
              open={Boolean(query) || section.key === 'configured' || (!setupComplete && section.key === 'recommended')}
              className="group/providers overflow-hidden rounded-2xl border border-border bg-card shadow-baziu-sm"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 marker:hidden sm:px-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Server className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{section.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {section.description}
                  </span>
                </span>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {section.providers.length}
                </span>
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open/providers:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-2 border-t border-border bg-muted/20 p-2 sm:p-3">
                {section.providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    p={provider}
                    initiallyOpen={
                      provider.enabled ||
                      Boolean(query) ||
                      (!setupComplete && provider.id === 'openai-codex')
                    }
                    openaiCodexStatus={
                      provider.id === 'openai-codex' ? openaiCodex : undefined
                    }
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </ConfigPage>
  )
}

function SummaryStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-baziu-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  )
}

function SetupBlockerBanner({
  providers,
  openaiCodex,
}: {
  providers: ProviderConfigEntry[]
  openaiCodex: OpenAICodexStatus
}) {
  const issues: string[] = []
  for (const p of providers) {
    if (!p.enabled) continue
    if (p.id === 'openai-codex' && !openaiCodex.connected) {
      issues.push(`${p.id}: enabled but ChatGPT is not connected — click "Connect ChatGPT" below`)
    }
    if (p.curated.length === 0) {
      issues.push(
        `${p.id}: enabled but no curated models — add at least one name in the "curated models" box below and save`,
      )
    }
  }
  const enabledCount = providers.filter((p) => p.enabled).length
  return (
    <div role="status" className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm">
      <div className="font-semibold text-foreground mb-1">Finish your first provider</div>
      <p className="text-muted-foreground mb-2">
        Enable one provider, save at least one exact model id, then send the small test request.
        Saving the model creates your default resources; a successful test confirms that the
        credential and model actually work.
      </p>
      {issues.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-warning">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : enabledCount === 0 ? (
        <p className="text-warning">
          No provider is enabled. Open a recommended option below and follow its steps.
        </p>
      ) : null}
    </div>
  )
}

function ProviderCard({
  p,
  openaiCodexStatus,
  initiallyOpen,
}: {
  p: ProviderConfigEntry
  openaiCodexStatus: OpenAICodexStatus | undefined
  initiallyOpen: boolean
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(p.enabled)
  const [expanded, setExpanded] = useState(initiallyOpen)
  const [models, setModels] = useState(p.curated.join('\n'))
  const [savingModels, setSavingModels] = useState(false)
  const [modelStatus, setModelStatus] = useState<
    { kind: 'success'; message: string } | { kind: 'error'; message: string } | null
  >(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [testModel, setTestModel] = useState(p.curated[0] ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    { kind: 'success'; message: string } | { kind: 'error'; message: string } | null
  >(null)
  const readiness = providerReadiness({ ...p, enabled })

  async function toggle(next: boolean) {
    setEnabled(next)
    setToggleError(null)
    try {
      const response = await fetch(`/api/config/providers/${encodeURIComponent(p.id)}/enabled`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not update provider (${response.status})`)
      }
      if (next) setExpanded(true)
      await router.invalidate()
    } catch (error) {
      setEnabled(!next)
      setToggleError(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveModels(e: React.FormEvent) {
    e.preventDefault()
    setSavingModels(true)
    setModelStatus(null)
    try {
      const list = models
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await fetch(`/api/config/providers/${encodeURIComponent(p.id)}/models`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models: list }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      setModelStatus({
        kind: 'success',
        message: 'Models saved. Run the connection test before relying on them.',
      })
      setTestModel(list[0] ?? '')
      setTestResult(null)
      await router.invalidate()
    } catch (e) {
      setModelStatus({ kind: 'error', message: (e as Error).message })
    } finally {
      setSavingModels(false)
    }
  }

  async function testConnection() {
    if (!testModel) return
    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: `${p.id}:${testModel}`,
          message: 'Reply with exactly: Bazilion connection verified.',
        }),
      })
      const body = (await response.json().catch(() => null)) as
        | (ProviderTestResponse & { error?: string })
        | null
      if (!response.ok) {
        throw new Error(body?.error ?? `Connection test failed (${response.status})`)
      }
      setTestResult({
        kind: 'success',
        message: `Verified ${p.displayName} with ${testModel}.`,
      })
      await router.invalidate()
    } catch (error) {
      setTestResult({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        <button
          type="button"
          className="unstyled flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
          aria-expanded={expanded}
          aria-controls={`provider-${p.id}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {p.displayName}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{p.id}</span>
          </span>
        </button>
        <StatusBadge variant={readiness.tone === 'success' ? 'success' : readiness.tone === 'warning' ? 'warning' : 'neutral'}>
          {readiness.label}
        </StatusBadge>
        <label className="m-0 flex cursor-pointer items-center gap-1.5 rounded-lg px-1 text-xs font-semibold">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4"
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${p.displayName}`}
          />
          <span className={enabled ? 'text-success' : 'text-muted-foreground'}>
            {enabled ? 'enabled' : 'disabled'}
          </span>
        </label>
        <span className="w-full pl-6 text-xs text-muted-foreground sm:w-auto sm:pl-0">
          {p.curated.length > 0 && <span>{p.curated.length} curated</span>}
          {p.catalog.length > 0 && <span> · {p.catalog.length} catalog</span>}
          {p.live && !p.live.error && <span> · {p.live.models.length} live</span>}
        </span>
      </header>

      {toggleError && <p role="alert" className="mx-4 mb-3 text-sm text-danger">{toggleError}</p>}

      {expanded && (
        <div id={`provider-${p.id}`} className="border-t border-dashed px-3 py-4 sm:px-4">
          {p.hint && <p className="text-xs text-muted-foreground mb-2">{p.hint}</p>}

          {p.id === 'openai-codex' && openaiCodexStatus && (
            <OpenAICodexCard status={openaiCodexStatus} />
          )}

          {p.fields.length === 0 && p.envHint && p.id !== 'openai-codex' && (
            <p className="text-xs text-muted-foreground">
              Credentials come from the process env: <code className="font-mono">{p.envHint}</code>
            </p>
          )}

          {p.fields.map((f) => (
            <FieldRow key={f.envVar} field={f} />
          ))}

          <h4
            id={`provider-${p.id}-models-label`}
            className="mt-4 mb-1 font-body text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Models available to agents
          </h4>
          {p.curated.length === 0 && (
            <p className="mb-2 text-xs font-medium text-warning">
              First-run setup needs at least one model name here — type one (e.g.{' '}
              <code className="font-mono">{exampleModelFor(p.id)}</code>) and click{' '}
              <em>save models</em>. Catalog chips below are the safest source when available.
            </p>
          )}
          <form onSubmit={saveModels}>
            <textarea
              id={`provider-${p.id}-models`}
              aria-labelledby={`provider-${p.id}-models-label`}
              value={models}
              onChange={(e) => setModels(e.target.value)}
              rows={Math.max(3, Math.min(8, models.split('\n').length))}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
              placeholder={
                p.catalog.length === 0 && !p.live
                  ? 'Type model names one per line, e.g. qwen3-coder-30b'
                  : 'Click catalog chips below, or type names one per line'
              }
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={savingModels}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {savingModels ? 'Saving…' : 'Save models'}
              </button>
              {modelStatus && (
                <span
                  role={modelStatus.kind === 'error' ? 'alert' : 'status'}
                  className={`text-xs ${
                    modelStatus.kind === 'error' ? 'text-danger' : 'text-success'
                  }`}
                >
                  {modelStatus.message}
                </span>
              )}
            </div>
          </form>

          {p.catalog.length > 0 && (
            <>
              <h4 className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                catalog
              </h4>
              <ChipList
                items={p.catalog}
                onPick={(name) => setModels((m) => (m.includes(name) ? m : `${m}\n${name}`.trim()))}
              />
            </>
          )}
          {p.live && !p.live.error && p.live.models.length > 0 && (
            <>
              <h4 className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                live
              </h4>
              <ChipList
                items={p.live.models}
                onPick={(name) => setModels((m) => (m.includes(name) ? m : `${m}\n${name}`.trim()))}
              />
            </>
          )}
          {p.live?.error && (
            <p role="alert" className="text-xs text-danger mt-2">Could not fetch live models: {p.live.error}</p>
          )}

          {enabled && p.curated.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
              <h4 className="m-0 font-body text-sm font-semibold text-foreground">
                Test the connection
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Sends one short real request. Your provider may charge its normal token cost.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="m-0 min-w-0 flex-1 text-xs font-semibold text-foreground">
                  Model
                  <select
                    className="mt-1"
                    value={testModel}
                    onChange={(event) => setTestModel(event.target.value)}
                  >
                    {p.curated.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  disabled={testing || !testModel}
                  onClick={() => void testConnection()}
                >
                  {testing ? 'Testing…' : 'Send test request'}
                </Button>
              </div>
              {testResult && (
                <p
                  role={testResult.kind === 'error' ? 'alert' : 'status'}
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    testResult.kind === 'error'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-success/10 text-success'
                  }`}
                >
                  {testResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Examples mirror pi-ai 0.85.1's current catalog. Refresh with the repository
// `refresh-pi-models` skill whenever Pi's catalog changes.
function exampleModelFor(providerId: string): string {
  switch (providerId) {
    case 'openai-codex':
      return 'gpt-6-astra'
    case 'openai':
      return 'gpt-6-astra'
    case 'anthropic':
      return 'claude-opus-5'
    case 'google':
      return 'gemini-3.6-flash'
    case 'google-vertex':
      return 'gemini-3.6-flash'
    case 'xai':
      return 'grok-4.5'
    case 'groq':
      return 'llama-3.3-70b-versatile'
    case 'cerebras':
      return 'gpt-oss-120b'
    case 'mistral':
      return 'mistral-large-latest'
    case 'zai':
      return 'glm-5.2'
    case 'huggingface':
      return 'Qwen/Qwen3.5-397B-A17B'
    case 'openrouter':
      return 'anthropic/claude-opus-5'
    case 'vercel-ai-gateway':
      return 'anthropic/claude-opus-5'
    case 'deepseek':
      return 'deepseek-v4-pro'
    case 'fireworks':
      return 'accounts/fireworks/models/kimi-k3'
    case 'together':
      return 'moonshotai/Kimi-K3'
    case 'baseten':
      return 'moonshotai/Kimi-K3'
    case 'moonshotai':
      return 'kimi-k3'
    case 'moonshotai-cn':
      return 'kimi-k3'
    case 'kimi-coding':
      return 'kimi-for-coding'
    case 'minimax':
      return 'MiniMax-M2.7'
    case 'minimax-cn':
      return 'MiniMax-M3'
    case 'qwen-token-plan':
      return 'qwen3.8-max'
    case 'qwen-token-plan-cn':
    case 'qwen-token-plan-individual':
      return 'qwen3.8-max'
    case 'ant-ling':
      return 'Ling-2.6-1T'
    case 'nvidia':
      return 'nvidia/nemotron-3-super-120b-a12b'
    case 'cloudflare-workers-ai':
      return '@cf/moonshotai/kimi-k2.6'
    case 'cloudflare-ai-gateway':
      return 'claude-opus-5'
    case 'github-copilot':
      return 'claude-opus-5'
    case 'xiaomi':
      return 'mimo-v2.5'
    case 'xiaomi-token-plan-ams':
    case 'xiaomi-token-plan-cn':
    case 'xiaomi-token-plan-sgp':
      return 'mimo-v2.5-pro'
    case 'opencode':
      return 'claude-opus-5'
    case 'opencode-go':
      return 'kimi-k2.7-code'
    case 'zai-coding-cn':
      return 'glm-5.2'
    case 'azure-openai':
      return 'gpt-5.6-luna'
    case 'bedrock':
      return 'global.anthropic.claude-opus-5'
    case 'ollama':
      return 'llama3.3'
    case 'lmstudio':
      return 'qwen3-coder-30b'
    case 'llamacpp':
      // llama-server exposes whatever .gguf was loaded; the id reported via
      // /v1/models is the model alias or filename. Pick something illustrative.
      return 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF:MXFP4_MOE'
    default:
      return 'model-name'
  }
}

function ChipList({ items, onPick }: { items: string[]; onPick: (name: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto rounded-md border bg-background p-1.5">
      {items.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onPick(m)}
          aria-label={`Add ${m} to selected models`}
          className="rounded border bg-card px-2 py-0.5 font-mono text-xs hover:border-primary hover:bg-accent"
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function OpenAICodexCard({ status }: { status: OpenAICodexStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const loginRequest = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      // A client-side route change does not automatically cancel fetch().
      // End the gateway request so the daemon can release its OAuth slot.
      loginRequest.current?.abort()
    },
    [],
  )

  async function connect() {
    loginRequest.current?.abort()
    const controller = new AbortController()
    loginRequest.current = controller
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/auth/openai/login', {
        method: 'POST',
        signal: controller.signal,
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      if (controller.signal.aborted) return
      await router.invalidate()
    } catch (e) {
      if (controller.signal.aborted) return
      setErr((e as Error).message)
    } finally {
      if (loginRequest.current === controller) {
        loginRequest.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }
  async function disconnect() {
    setBusy(true)
    setErr(null)
    try {
      const response = await fetch('/api/auth/openai', { method: 'DELETE' })
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not disconnect ChatGPT (${response.status})`)
      }
      await router.invalidate()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="rounded-md border bg-muted/30 p-3 mb-3">
      {status.connected ? (
        <>
          <div className="flex flex-wrap gap-2 items-center mb-2">
            <span className="rounded-full bg-success/10 text-success px-2 py-0.5 text-xs font-semibold uppercase">
              connected
            </span>
            {status.accountId && (
              <span className="text-xs text-muted-foreground">
                account <code className="font-mono">{status.accountId}</code>
              </span>
            )}
            {status.expiresAt && (
              <span className="text-xs text-muted-foreground">
                token expires{' '}
                {new Date(status.expiresAt).toISOString().replace(/\.\d+Z$/, 'Z')}
              </span>
            )}
          </div>
          <Button variant="danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
            Disconnect ChatGPT
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Sign in with your ChatGPT account — the OAuth flow opens a new browser tab. The
            loopback callback at <code className="font-mono">localhost:1455</code> only works
            when you're using the web UI on the same machine as the daemon. For remote setups or
            callback trouble, run{' '}
            <code className="font-mono">bazilion auth openai login --device-code</code> on the
            client. From a source checkout, run{' '}
            <code className="font-mono">
              pnpm tsx apps/cli/src/index.ts auth openai login --device-code
            </code>{' '}
            from the repository root.
          </p>
          <Button
            variant="primary"
            onClick={connect}
            disabled={busy}
          >
            {busy ? 'opening browser…' : 'Connect ChatGPT →'}
          </Button>
        </>
      )}
      {err && <p role="alert" className="text-sm text-danger mt-2">{err}</p>}
    </div>
    <ConfirmDialog
      open={confirmDisconnect}
      onOpenChange={setConfirmDisconnect}
      title="Disconnect ChatGPT?"
      description={
        <p>
          This removes the saved OpenAI Codex OAuth credentials. Agents using an{' '}
          <code>openai-codex</code> model will stop working until you connect again.
        </p>
      }
      confirmLabel="Disconnect ChatGPT"
      onConfirm={disconnect}
    />
    </>
  )
}
