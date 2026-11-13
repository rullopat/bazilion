import type {
  CreateTokenRequest,
  CreateTokenResponse,
  ListSessionsResponse,
  ListTokensResponse,
  WebSession,
  WebToken,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { ConfigPage } from '../../components/ConfigPage'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ItemList, ItemRow, SectionCard, StatusBadge } from '../../components/Page'
import { api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const fetchTokens = createServerFn({ method: 'GET' })
  .validator((data: { all: boolean }) => data)
  .handler(async ({ data }) => {
    const client = daemonClient()
    const [tokens, sessions] = await Promise.all([
      client.get<ListTokensResponse>(`/api/tokens${data.all ? '?includeRevoked=1' : ''}`),
      client.get<ListSessionsResponse>('/api/sessions'),
    ])
    return { ...tokens, ...sessions }
  })

export const Route = createFileRoute('/config/tokens')({
  // The router parses `?all=1` into the number 1 (and would rewrite a string '1' as `"1"`).
  validateSearch: (search: Record<string, unknown>): { all?: 1 } => ({
    all: search.all === 1 ? 1 : undefined,
  }),
  loaderDeps: ({ search }) => ({ all: search.all === 1 }),
  loader: ({ deps }) => fetchTokens({ data: deps }),
  component: TokensPage,
})

function when(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')
}

function TokensPage() {
  const { tokens, sessions } = Route.useLoaderData()
  const includeRevoked = Route.useSearch().all === 1
  const router = useRouter()
  const [revokeToken, setRevokeToken] = useState<WebToken | null>(null)
  const [revokeSession, setRevokeSession] = useState<WebSession | null>(null)
  const usesToken = (token: WebToken | null) =>
    sessions.some((session) => session.current && session.tokenId === token?.id)

  /** Revoking the session this browser uses signs it out. */
  async function afterRevoke(signedOut: boolean) {
    if (signedOut) window.location.assign('/login')
    else await router.invalidate()
  }

  return (
    <ConfigPage
      title="API tokens"
      description={
        <>
          Every token has full access to the HTTP API, the CLI and browser login. The{' '}
          <code className="font-mono">bootstrap</code> token from{' '}
          <code className="font-mono">~/.bazilion/auth.json</code> cannot be revoked; mint a
          separate, revocable token for each other device.
        </>
      }
    >
      <MintTokenForm onMinted={() => router.invalidate()} />

      <SectionCard
        title="Tokens"
        actions={
          <a
            className="ghost-btn"
            href={includeRevoked ? '/config/tokens' : '/config/tokens?all=1'}
          >
            {includeRevoked ? 'Hide revoked' : 'Show revoked'}
          </a>
        }
      >
        {tokens.length === 0 ? (
          <p className="muted">No tokens yet; mint one above.</p>
        ) : (
          <ItemList>
            {tokens.map((token) => {
              const bootstrap = token.kind === 'bootstrap'
              const expired = token.expiresAt !== null && token.expiresAt <= Date.now()
              return (
                <ItemRow
                  key={token.id}
                  title={token.label}
                  meta={
                    <>
                      <StatusBadge variant={token.revokedAt || expired ? 'neutral' : 'success'}>
                        {token.revokedAt ? 'revoked' : expired ? 'expired' : 'active'}
                      </StatusBadge>
                      <span>{bootstrap ? 'bootstrap (auth.json)' : token.kind}</span>
                      <span>created {when(token.createdAt)}</span>
                      <span>last used {token.lastUsedAt ? when(token.lastUsedAt) : 'never'}</span>
                      <span>expires {token.expiresAt ? when(token.expiresAt) : 'never'}</span>
                      <code>{token.id}</code>
                    </>
                  }
                  actions={
                    !token.revokedAt &&
                    !bootstrap && (
                      <Button variant="danger" onClick={() => setRevokeToken(token)}>
                        Revoke
                      </Button>
                    )
                  }
                />
              )
            })}
          </ItemList>
        )}
      </SectionCard>

      <SectionCard
        title="Browser sessions"
        description="A session ends after 30 days without use. Revoking a token also ends every session opened with it."
      >
        {sessions.length === 0 ? (
          <p className="muted">No active browser sessions.</p>
        ) : (
          <ItemList>
            {sessions.map((session) => (
              <ItemRow
                key={session.id}
                title={
                  <>
                    {session.tokenLabel}{' '}
                    {session.current && <StatusBadge variant="success">current</StatusBadge>}
                  </>
                }
                meta={
                  <>
                    <span>last seen {when(session.lastSeenAt)}</span>
                    <span>expires {when(session.expiresAt)}</span>
                    <code>{session.id}</code>
                  </>
                }
                actions={
                  <Button variant="danger" onClick={() => setRevokeSession(session)}>
                    Revoke
                  </Button>
                }
              />
            ))}
          </ItemList>
        )}
      </SectionCard>

      <ConfirmDialog
        open={revokeToken !== null}
        title={`Revoke ${revokeToken?.label ?? ''}?`}
        description={
          <p>
            This permanently revokes token <code className="font-mono">{revokeToken?.id}</code> and
            ends every browser session opened with it.
            {usesToken(revokeToken) && ' This includes the session you are using now.'}
          </p>
        }
        confirmLabel="Revoke token and sessions"
        onConfirm={async () => {
          if (!revokeToken) return
          await api(`/api/tokens/${encodeURIComponent(revokeToken.id)}`, { method: 'DELETE' })
          await afterRevoke(usesToken(revokeToken))
        }}
        onOpenChange={(open) => {
          if (!open) setRevokeToken(null)
        }}
      />
      <ConfirmDialog
        open={revokeSession !== null}
        title={`Revoke the ${revokeSession?.tokenLabel ?? ''} browser session?`}
        description={
          <p>
            This ends browser session <code className="font-mono">{revokeSession?.id}</code>
            {revokeSession?.current
              ? ' and signs this browser out.'
              : '. The token stays active for later logins.'}
          </p>
        }
        confirmLabel={revokeSession?.current ? 'Sign out this browser' : 'Revoke session'}
        onConfirm={async () => {
          if (!revokeSession) return
          await api(`/api/sessions/${encodeURIComponent(revokeSession.id)}`, { method: 'DELETE' })
          await afterRevoke(revokeSession.current)
        }}
        onOpenChange={(open) => {
          if (!open) setRevokeSession(null)
        }}
      />
    </ConfigPage>
  )
}

function MintTokenForm({ onMinted }: { onMinted: () => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [expiresDays, setExpiresDays] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function mint(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { token } = await api<CreateTokenResponse>('/api/tokens', {
        // An empty expiry means the token never expires.
        body: {
          label,
          ...(expiresDays ? { expiresInDays: Number(expiresDays) } : {}),
        } satisfies CreateTokenRequest,
      })
      setCreated(token)
      setLabel('')
      setExpiresDays('')
      await onMinted()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="Mint a new token">
      <form
        onSubmit={(event) => void mint(event)}
        className="flex flex-col items-stretch gap-x-3 sm:flex-row sm:items-end"
      >
        <label className="sm:w-72">
          Label
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            placeholder="e.g. laptop-tailscale"
            autoComplete="off"
          />
        </label>
        <label className="sm:w-40">
          Expires in days
          <input
            type="number"
            min={1}
            value={expiresDays}
            onChange={(event) => setExpiresDays(event.target.value)}
            placeholder="never"
          />
        </label>
        <Button variant="primary" type="submit" disabled={busy} className="mb-[0.6rem]">
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {created && (
        <div className="rounded-md border border-warning/25 bg-warning/10 p-3">
          <p className="mb-1 text-xs text-warning">
            Copy this token now; it cannot be shown again.
          </p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">{created}</pre>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </SectionCard>
  )
}
