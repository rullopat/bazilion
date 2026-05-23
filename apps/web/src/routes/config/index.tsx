import type { ProviderConfigEntry, ProviderConfigResponse } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigTabs } from '../../components/ConfigTabs'
import { FieldRow } from '../../components/FieldRow'
import { daemonClient } from '../../lib/daemon-client'

interface OpenAICodexStatus {
  connected: boolean
  expiresAt: number | null
  accountId: string | null
}

interface ProvidersData {
  providers: ProviderConfigEntry[]
  openaiCodex: OpenAICodexStatus
}

const fetchProvidersData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProvidersData> => {
    const c = daemonClient()
    const [{ providers }, openaiCodex] = await Promise.all([
      c.get<ProviderConfigResponse>('/api/config/providers'),
      c.get<OpenAICodexStatus>('/api/auth/openai'),
    ])
    return { providers, openaiCodex }
  },
)

export const Route = createFileRoute('/config/')({
  loader: () => fetchProvidersData(),
  component: ProvidersPage,
})

function ProvidersPage() {
  const { providers, openaiCodex } = Route.useLoaderData()
  const setupComplete = providers.some((p) => p.enabled && p.curated.length > 0)
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground mb-2">config</h1>
      <ConfigTabs active="providers" />
      {!setupComplete && <SetupBlockerBanner providers={providers} openaiCodex={openaiCodex} />}
      <p className="text-muted-foreground text-sm mb-6">
        Each card configures one LLM provider end to end: credentials (encrypted in the{' '}
        <code className="font-mono">secrets</code> table), URLs and IDs (plaintext in the{' '}
        <code className="font-mono">config</code> table), and the curated model list that
        powers profile / agent dropdowns.
      </p>
      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          p={p}
          openaiCodexStatus={p.id === 'openai-codex' ? openaiCodex : undefined}
        />
      ))}
    </main>
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
    <div className="rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 mb-4 text-sm">
      <div className="font-semibold text-amber-900 mb-1">First-run setup is not complete</div>
      <p className="text-amber-900 mb-2">
        The rest of the app stays on the Welcome screen until at least one provider is{' '}
        <strong>enabled</strong> and has <strong>at least one curated model</strong>.
      </p>
      {issues.length > 0 ? (
        <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : enabledCount === 0 ? (
        <p className="text-amber-900">
          No providers are enabled yet — pick one below, flip the toggle on, set credentials,
          and add a model name.
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
    <section className="rounded-lg border bg-card mb-3 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="font-mono font-semibold">{p.id}</span>
        <span className="text-muted-foreground text-sm">· {p.displayName}</span>
        <label className="flex items-center gap-1.5 text-xs uppercase tracking-wide font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            className="size-4"
          />
          <span className={enabled ? 'text-emerald-700' : 'text-muted-foreground'}>
            {enabled ? 'enabled' : 'disabled'}
          </span>
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
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
            <p className="mb-2 text-xs font-medium text-amber-700">
              First-run setup needs at least one model name here — type one (e.g.{' '}
              <code className="font-mono">{exampleModelFor(p.id)}</code>) and click{' '}
              <em>save models</em>.
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
            <p className="text-xs text-rose-700 mt-2">could not fetch: {p.live.error}</p>
          )}
        </div>
      )}
    </section>
  )
}

// Examples mirror pi-ai 0.75's current catalog. Update when bumping pi-ai.
function exampleModelFor(providerId: string): string {
  switch (providerId) {
    case 'openai-codex':
      return 'gpt-5.3-codex'
    case 'openai':
      return 'gpt-5.4'
    case 'anthropic':
      return 'claude-opus-4-7'
    case 'google':
      return 'gemini-2.5-pro'
    case 'google-vertex':
      return 'gemini-2.5-pro'
    case 'xai':
      return 'grok-4.3'
    case 'groq':
      return 'llama-3.3-70b-versatile'
    case 'cerebras':
      return 'qwen-3-235b-a22b-instruct-2507'
    case 'mistral':
      return 'mistral-large-latest'
    case 'zai':
      return 'glm-5.1'
    case 'huggingface':
      return 'Qwen/Qwen3-235B-A22B-Thinking-2507'
    case 'openrouter':
      return 'anthropic/claude-opus-4.7'
    case 'vercel-ai-gateway':
      return 'anthropic/claude-opus-4.7'
    case 'deepseek':
      return 'deepseek-v4-pro'
    case 'fireworks':
      return 'accounts/fireworks/models/deepseek-v4-pro'
    case 'together':
      return 'Qwen/Qwen3.6-Plus'
    case 'moonshotai':
      return 'kimi-k2.6'
    case 'kimi-coding':
      return 'kimi-for-coding'
    case 'minimax':
      return 'MiniMax-M2.7'
    case 'cloudflare-workers-ai':
      return '@cf/moonshotai/kimi-k2.6'
    case 'cloudflare-ai-gateway':
      return 'claude-opus-4-7'
    case 'github-copilot':
      return 'claude-opus-4.7'
    case 'xiaomi':
      return 'mimo-v2.5'
    case 'opencode':
      return 'claude-opus-4-5'
    case 'azure-openai':
      return 'gpt-5.4'
    case 'bedrock':
      return 'anthropic.claude-opus-4-7-20251101-v1:0'
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
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs font-semibold uppercase">
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
            className="rounded-md border px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
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
      {err && <p className="text-sm text-rose-700 mt-2">{err}</p>}
    </div>
  )
}
