// The cards of the Access page: minting a token, the tokens there are, and the browsers that
// are signed in with them.

import type { CreateTokenResponse, WebSession, WebToken } from '@bazilion/api-types'
import { KeyRound, MonitorSmartphone, Plus } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { type TokenDraft, tokenForm, tokenState, when } from '../../lib/token-form'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { TextField } from './form'
import { CardForm, CardList, CardRow, Chip, ListRow, Notice, SetupCard } from './parts'

/** A token for another device, a script, or the CLI on another machine. */
export function MintTokenCard({ onMinted }: { onMinted: () => Promise<void> }) {
  const [draft, setDraft] = useState<TokenDraft>({ label: '', days: '' })
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const form = tokenForm(draft)

  const edit = (change: Partial<TokenDraft>) => {
    setError(null)
    setDraft((current) => ({ ...current, ...change }))
  }

  async function mint(event: React.FormEvent) {
    event.preventDefault()
    if (!form.body || busy) return
    setBusy(true)
    setError(null)
    try {
      const { token } = await api<CreateTokenResponse>('/api/tokens', { body: form.body })
      setCreated(token)
      setDraft({ label: '', days: '' })
      await onMinted()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SetupCard
      labelledBy="access-mint"
      icon={<Plus className="size-5" />}
      title="Mint a new token"
      description="One for each other device or script, so that each can be revoked on its own."
    >
      <CardForm onSubmit={mint}>
        <div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,11rem)]">
          <TextField
            label="Label"
            value={draft.label}
            disabled={busy}
            placeholder="e.g. laptop-tailscale"
            onChange={(label) => edit({ label })}
          />
          <TextField
            label="Expires in days"
            value={draft.days}
            disabled={busy}
            placeholder="never"
            inputMode="numeric"
            problem={form.problems.days}
            onChange={(days) => edit({ days })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="primary" type="submit" disabled={busy || !form.body}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
          {error ? (
            <p
              role="alert"
              className="m-0 min-w-0 flex-1 basis-56 text-sm font-medium text-warning"
            >
              Nothing was created: {error}
            </p>
          ) : (
            form.missing && (
              <p
                role="status"
                className="m-0 min-w-0 flex-1 basis-56 text-sm font-medium text-warning"
              >
                {form.missing}
              </p>
            )
          )}
        </div>
        {created && (
          <Notice tone="warning" title="Copy this token now; it cannot be shown again.">
            <code className="mt-1 block break-all bg-transparent p-0 text-[0.85em] text-foreground">
              {created}
            </code>
          </Notice>
        )}
      </CardForm>
    </SetupCard>
  )
}

/** Every token that signs in: the one in `auth.json`, and one per other device. */
export function TokensCard({
  tokens,
  sessions,
  includeRevoked,
  now,
  onRevoked,
}: {
  tokens: WebToken[]
  /** The browser sessions, to say when revoking a token signs this browser out. */
  sessions: WebSession[]
  includeRevoked: boolean
  /** The moment the list was loaded: expiry is counted from one clock. */
  now: number
  /** Called after a token is revoked; `signedOut` when this browser was signed in with it. */
  onRevoked: (signedOut: boolean) => Promise<void>
}) {
  const [revoking, setRevoking] = useState<WebToken | null>(null)
  const usedHere = (token: WebToken | null) =>
    sessions.some((session) => session.current && session.tokenId === token?.id)

  return (
    <SetupCard
      labelledBy="access-tokens"
      icon={<KeyRound className="size-5" />}
      title="Tokens"
      description="Each signs in to the HTTP API, the CLI and the web UI, with full access."
      action={
        <a className="ghost-btn" href={includeRevoked ? '/config/access' : '/config/access?all=1'}>
          {includeRevoked ? 'Hide revoked' : 'Show revoked'}
        </a>
      }
    >
      {tokens.length === 0 ? (
        <CardRow className="py-4 text-sm text-muted-foreground">
          No tokens yet; mint one above.
        </CardRow>
      ) : (
        <CardList>
          {tokens.map((token) => {
            const bootstrap = token.kind === 'bootstrap'
            const state = tokenState(token, now)
            return (
              <ListRow
                key={token.id}
                title={token.label}
                chip={<Chip tone={state.tone}>{state.label}</Chip>}
                meta={
                  <>
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
                    <Button
                      variant="danger"
                      aria-label={`Revoke ${token.label}`}
                      onClick={() => setRevoking(token)}
                    >
                      Revoke
                    </Button>
                  )
                }
              />
            )
          })}
        </CardList>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={`Revoke ${revoking?.label ?? ''}?`}
        description={
          <p className="m-0">
            This permanently revokes token <code>{revoking?.id}</code> and ends every browser
            session opened with it.
            {usedHere(revoking) && ' This includes the session you are using now.'}
          </p>
        }
        confirmLabel="Revoke token and sessions"
        onConfirm={async () => {
          if (!revoking) return
          await api(`/api/tokens/${encodeURIComponent(revoking.id)}`, { method: 'DELETE' })
          await onRevoked(usedHere(revoking))
        }}
      />
    </SetupCard>
  )
}

/** The browsers that are signed in. */
export function SessionsCard({
  sessions,
  onRevoked,
}: {
  sessions: WebSession[]
  /** Called after a session is revoked; `signedOut` when it was this browser's. */
  onRevoked: (signedOut: boolean) => Promise<void>
}) {
  const [revoking, setRevoking] = useState<WebSession | null>(null)
  return (
    <SetupCard
      labelledBy="access-sessions"
      icon={<MonitorSmartphone className="size-5" />}
      title="Browser sessions"
      description="A session ends after 30 days without use. Revoking a token also ends every session opened with it."
    >
      {sessions.length === 0 ? (
        <CardRow className="py-4 text-sm text-muted-foreground">
          No active browser sessions.
        </CardRow>
      ) : (
        <CardList>
          {sessions.map((session) => (
            <ListRow
              key={session.id}
              title={session.tokenLabel}
              chip={session.current && <Chip tone="success">This browser</Chip>}
              meta={
                <>
                  <span>last seen {when(session.lastSeenAt)}</span>
                  <span>expires {when(session.expiresAt)}</span>
                  <code>{session.id}</code>
                </>
              }
              actions={
                <Button
                  variant="danger"
                  aria-label={
                    session.current
                      ? 'Revoke the session of this browser'
                      : `Revoke the ${session.tokenLabel} session last seen ${when(session.lastSeenAt)}`
                  }
                  onClick={() => setRevoking(session)}
                >
                  Revoke
                </Button>
              }
            />
          ))}
        </CardList>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={`Revoke the ${revoking?.tokenLabel ?? ''} browser session?`}
        description={
          <p className="m-0">
            This ends browser session <code>{revoking?.id}</code>
            {revoking?.current
              ? ' and signs this browser out.'
              : '. The token stays active for later logins.'}
          </p>
        }
        confirmLabel={revoking?.current ? 'Sign out this browser' : 'Revoke session'}
        onConfirm={async () => {
          if (!revoking) return
          await api(`/api/sessions/${encodeURIComponent(revoking.id)}`, { method: 'DELETE' })
          await onRevoked(revoking.current)
        }}
      />
    </SetupCard>
  )
}
