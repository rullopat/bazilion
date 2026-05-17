import type { ListTokensResponse } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigTabs } from '../../components/ConfigTabs'
import { daemonClient } from '../../lib/daemon-client'

const fetchTokens = createServerFn({ method: 'POST' })
  .inputValidator((d: { all: boolean }) => d)
  .handler(({ data }) =>
    daemonClient().get<ListTokensResponse>(
      `/api/tokens${data.all ? '?includeRevoked=1' : ''}`,
    ),
  )

export const Route = createFileRoute('/config/tokens')({
  validateSearch: (s: Record<string, unknown>): { all?: '1' } => ({
    all: s.all === '1' ? '1' : undefined,
  }),
  loaderDeps: ({ search }) => ({ all: search.all === '1' }),
  loader: ({ deps }) => fetchTokens({ data: deps }),
  component: TokensPage,
})

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

function TokensPage() {
  const { tokens } = Route.useLoaderData()
  const { all } = Route.useSearch()
  const includeRevoked = all === '1'
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function mint(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      const body = (await res.json()) as { token: string }
      setCreated(body.token)
      setLabel('')
      await router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/tokens/${id}`, { method: 'DELETE' })
    await router.invalidate()
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground mb-2">config</h1>
      <ConfigTabs active="tokens" />

      <p className="text-muted-foreground text-sm mb-6">
        Per-client credentials for the HTTP API and CLI. The row labelled{' '}
        <code className="font-mono">bootstrap</code> is the loopback token in{' '}
        <code className="font-mono">~/.bazilion/auth.json</code> — revoking it locks the local
        CLI out, so it can't be revoked from this page. Mint additional tokens here for
        Tailscale/LAN clients (mobile, remote machines); revoke any of those at any time.
      </p>

      <section className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="font-serif text-xl mb-3">Mint a new token</h3>
        <form onSubmit={mint} className="flex gap-2 items-end mb-3">
          <label className="text-sm">
            Label
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              placeholder="e.g. laptop-tailscale"
              autoComplete="off"
              className="block mt-1 rounded-md border bg-background px-3 py-2 text-sm w-72"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'creating…' : 'create'}
          </button>
        </form>
        {created && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800 mb-1">
              copy this token now — it is not recoverable later.
            </p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-all">{created}</pre>
          </div>
        )}
        {err && <p className="text-sm text-rose-700">{err}</p>}
      </section>

      <div className="mb-3">
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeRevoked}
            onChange={(e) => {
              window.location.assign(e.target.checked ? '/config/tokens?all=1' : '/config/tokens')
            }}
          />
          show revoked
        </label>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground border-b">
          <tr>
            <th className="py-2">label</th>
            <th>id</th>
            <th>state</th>
            <th>created</th>
            <th>last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground italic">
                no tokens yet — mint one above
              </td>
            </tr>
          )}
          {tokens.map((t) => {
            const isBootstrap = t.label === 'bootstrap'
            return (
              <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                <td className="py-2">
                  {t.label}
                  {isBootstrap && (
                    <span className="ml-2 text-[0.7em] uppercase tracking-wide text-muted-foreground">
                      auth.json
                    </span>
                  )}
                </td>
                <td>
                  <code className="font-mono text-xs">{t.id}</code>
                </td>
                <td>
                  {t.revokedAt ? (
                    <span className="text-muted-foreground">revoked</span>
                  ) : (
                    <span className="text-emerald-700">active</span>
                  )}
                </td>
                <td className="text-muted-foreground text-xs">{fmtTs(t.createdAt)}</td>
                <td className="text-muted-foreground text-xs">
                  {t.lastUsedAt ? fmtTs(t.lastUsedAt) : '(never)'}
                </td>
                <td>
                  {!t.revokedAt && !isBootstrap && (
                    <button
                      type="button"
                      onClick={() => revoke(t.id)}
                      className="rounded-md border px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      revoke
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}
