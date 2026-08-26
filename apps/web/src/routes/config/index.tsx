import type {
  HealthReport,
  OpenAICodexStatus,
  ProviderConfigEntry,
  ProviderConfigResponse,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigPage } from '../../components/ConfigPage'
import { ExecutionSecurityCard } from '../../components/ExecutionSecurityCard'
import { FieldRow } from '../../components/FieldRow'
import { daemonClient } from '../../lib/daemon-client'

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
  return (
    <ConfigPage
      active="providers"
      title="Providers"
      description={
        <>
          Configure credentials, endpoints, and the curated model lists used by agent
          templates and running agents. Secrets are encrypted; URLs and IDs remain
          inspectable configuration.
        </>
      }
    >
      <ExecutionSecurityCard status={executionSecurity} />
      {!setupComplete && <SetupBlockerBanner providers={providers} openaiCodex={openaiCodex} />}
      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            openaiCodexStatus={p.id === 'openai-codex' ? openaiCodex : undefined}
          />
        ))}
      </div>
    </ConfigPage>
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
    <div className="rounded-md border-2 border-warning/25 bg-warning/10 px-4 py-3 text-sm">
      <div className="font-semibold text-warning mb-1">First-run setup is not complete</div>
      <p className="text-warning mb-2">
        The rest of the app stays on the Welcome screen until at least one provider is{' '}
        <strong>enabled</strong> and has <strong>at least one curated model</strong>. Use a
        catalog chip when one is available, or paste the exact model id from your local/server
        provider.
      </p>
      {issues.length > 0 ? (
        <ul className="list-disc pl-5 text-warning space-y-0.5">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : enabledCount === 0 ? (
        <p className="text-warning">
          No providers are enabled yet — pick one below, flip the toggle on, set credentials,
          and save at least one model name.
        </p>
      ) : null}
    </div>
  )
}

function ProviderCard({
  p,
  openaiCodexStatus,
}: {
  p: ProviderConfigEntry
  openaiCodexStatus: OpenAICodexStatus | undefined
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(p.enabled)
  const [models, setModels] = useState(p.curated.join('\n'))
  const [savingModels, setSavingModels] = useState(false)
  const [modelStatus, setModelStatus] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setEnabled(next)
    try {
      await fetch(`/api/config/providers/${encodeURIComponent(p.id)}/enabled`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      await router.invalidate()
    } catch {
      setEnabled(!next)
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
      setModelStatus('saved ✓')
      await router.invalidate()
    } catch (e) {
      setModelStatus(`error: ${(e as Error).message}`)
    } finally {
      setSavingModels(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="font-mono font-semibold">{p.id}</span>
        <span className="text-muted-foreground text-sm">· {p.displayName}</span>
        <label className="flex items-center gap-1.5 text-xs uppercase tracking-wide font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4"
          />
          <span className={enabled ? 'text-success' : 'text-muted-foreground'}>
            {enabled ? 'enabled' : 'disabled'}
          </span>
        </label>
        <span className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          {p.curated.length > 0 && <span>{p.curated.length} curated</span>}
          {p.catalog.length > 0 && <span> · {p.catalog.length} catalog</span>}
          {p.live && !p.live.error && <span> · {p.live.models.length} live</span>}
        </span>
      </header>

      {enabled && (
        <div className="border-t border-dashed px-4 py-3">
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

          <h4 className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            curated models (one per line)
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
                save models
              </button>
              {modelStatus && (
                <span className="text-xs text-muted-foreground">{modelStatus}</span>
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
            <p className="text-xs text-danger mt-2">could not fetch: {p.live.error}</p>
          )}
        </div>
      )}
    </section>
  )
}

// Examples mirror pi-ai 0.83's current catalog. Refresh with the repository
// `refresh-pi-models` skill whenever Pi's catalog changes.
function exampleModelFor(providerId: string): string {
  switch (providerId) {
    case 'openai-codex':
      return 'gpt-5.6-luna'
    case 'openai':
      return 'gpt-5.6-luna'
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
      return 'zai-glm-4.7'
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
    case 'qwen-token-plan-cn':
      return 'qwen3.8-max-preview'
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

  async function connect() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/auth/openai/login', { method: 'POST' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function disconnect() {
    setBusy(true)
    setErr(null)
    try {
      await fetch('/api/auth/openai', { method: 'DELETE' })
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
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
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Sign in with your ChatGPT account — the OAuth flow opens a new browser tab. The
            loopback callback at <code className="font-mono">localhost:1455</code> only works
            when you're using the web UI on the same machine as the daemon. For remote setups,
            run <code className="font-mono">bazilion auth openai login</code> on the client.
          </p>
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'opening browser…' : 'Connect ChatGPT →'}
          </button>
        </>
      )}
      {err && <p className="text-sm text-danger mt-2">{err}</p>}
    </div>
  )
}
