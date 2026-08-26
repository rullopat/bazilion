import type { ListTokensResponse } from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigPage } from '../../components/ConfigPage'
import { daemonClient } from '../../lib/daemon-client'

const fetchTokens = createServerFn({ method: 'POST' })
  .validator((d: { all: boolean }) => d)
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
    <ConfigPage
      active="tokens"
      title="API tokens"
      description={
        <>
          Manage per-client credentials for the HTTP API and CLI. The{' '}
          <code className="font-mono">bootstrap</code> token from{' '}
          <code className="font-mono">~/.bazilion/auth.json</code> remains protected; mint
          separate credentials for mobile, LAN, and remote clients.
        </>
      }
    >
      <section className="rounded-lg border bg-card p-5">
        <h3 className="font-serif text-xl mb-3">Mint a new token</h3>
        <form
          onSubmit={mint}
          className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end"
        >
          <label className="w-full text-sm sm:w-auto">
            Label
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              placeholder="e.g. laptop-tailscale"
              autoComplete="off"
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm sm:w-72"
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
          <div className="rounded-md border border-warning/25 bg-warning/10 p-3">
            <p className="text-xs text-warning mb-1">
              copy this token now — it is not recoverable later.
            </p>
            <pre className="font-mono text-xs whitespace-pre-wrap break-all">{created}</pre>
          </div>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
      </section>

      <div>
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
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
                      <span className="text-success">active</span>
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
                        className="rounded-md border px-2 py-1 text-xs text-danger hover:bg-danger/10"
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
      </div>
    </ConfigPage>
  )
}
