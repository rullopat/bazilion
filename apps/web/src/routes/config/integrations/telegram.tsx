// /config/integrations/telegram — Step 1 setup form + health card.
//
// Two-field credentials form (bot token + supergroup chat id) wired to
// PUT /api/config/telegram, plus a "run preflight" button that hits
// GET /api/config/telegram/health and renders the four green/red checks
// (bot identity, forum mode, can_manage_topics, privacy mode off).
//
// The "awaiting activation" banner stays visible until Step 2 ships — by
// design Step 1 does not start a live bot, create the service chat, or
// post any messages into Telegram. Saving credentials here only seeds
// storage so Step 2 can activate on its next restart.

import type {
  TelegramAllowedUser,
  TelegramConfigState,
  TelegramHealth,
  TelegramPairingChallenge,
  TelegramPairingStatus,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ConfigPage } from '../../../components/ConfigPage'
import { daemonClient } from '../../../lib/daemon-client'

const fetchTelegramConfig = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<TelegramConfigState>('/api/config/telegram'),
)

export const Route = createFileRoute('/config/integrations/telegram')({
  loader: () => fetchTelegramConfig(),
  component: TelegramIntegrationPage,
})

function TelegramIntegrationPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()

  // Token field stays empty on load — we never echo the saved secret back
  // into a form input. The state.configured flag + botTokenPreview tell the
  // user whether something is already stored.
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(initial.chatId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const [health, setHealth] = useState<TelegramHealth | null>(null)
  const [checking, setChecking] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (initial.configured && token.trim().length === 0) {
      setSaveOk(false)
      setSaveError(
        chatId.trim() === initial.chatId
          ? 'Nothing changed. Paste a replacement token to update credentials.'
          : 'Paste the bot token again when changing the supergroup, so the existing secret is never cleared or reused silently.',
      )
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const res = await fetch('/api/config/telegram', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botToken: token, chatId }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `${res.status} ${res.statusText}`)
      }
      setToken('')
      setSaveOk(true)
      await router.invalidate()
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    const response = await fetch('/api/config/telegram', { method: 'DELETE' })
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Could not clear Telegram credentials (${response.status})`)
    }
    setToken('')
    setChatId('')
    setHealth(null)
    setSaveOk(false)
    setSaveError(null)
    await router.invalidate()
  }

  async function runHealth() {
    setChecking(true)
    setHealth(null)
    try {
      const res = await fetch('/api/config/telegram/health')
      const json = (await res.json()) as TelegramHealth
      setHealth(json)
    } catch (e) {
      setHealth({
        configured: true,
        preflight: null,
        error: { step: 'getMe', message: (e as Error).message },
        polling: null,
      })
    } finally {
      setChecking(false)
    }
  }

  return (
    <ConfigPage
      active="integrations"
      title="Telegram"
      description="Connect one forum-supergroup bot with one topic per agent, so conversations stay reachable from your phone."
      size="narrow"
    >
      {initial.migratedChatId && <MigrationBanner toChatId={initial.migratedChatId} />}

      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Credentials
        </h3>

        {initial.configured && (
          <p className="text-xs text-success mb-3">
            ✓ Stored: <code className="font-mono">{initial.botTokenPreview}</code>{' '}
            {initial.chatId && (
              <>
                · chat <code className="font-mono">{initial.chatId}</code>
              </>
            )}
          </p>
        )}

        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Bot token</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setSaveError(null)
              }}
              placeholder={initial.configured ? '(leave blank to keep stored value)' : '1234567890:ABC...'}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
              required={!initial.configured}
            />
            <p className="text-xs text-muted-foreground mt-1">
              From @BotFather → /newbot. Disable Privacy Mode in <em>Bot Settings → Team
              Privacy → Turn off</em>.
            </p>
            {initial.configured && (
              <p className="mt-1 text-xs text-muted-foreground">
                Blank preserves the stored token. To remove it, use clear credentials and confirm
                the integration shutdown.
              </p>
            )}
          </label>

          <label className="block">
            <span className="block text-sm font-medium mb-1">Supergroup chat ID</span>
            <input
              type="text"
              value={chatId}
              onChange={(e) => {
                setChatId(e.target.value)
                setSaveError(null)
              }}
              placeholder="-1001234567890"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Forum-enabled supergroup the bot is admin in (with{' '}
              <code className="font-mono">can_manage_topics</code>).
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'saving…' : 'save credentials'}
            </Button>
            {initial.configured && (
              <Button variant="danger" onClick={() => setConfirmDisconnect(true)}>
                clear credentials
              </Button>
            )}
            {saveOk && <span className="text-xs text-success">saved ✓</span>}
            {saveError && <span role="alert" className="text-xs text-danger">error: {saveError}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Preflight checks
          </h3>
          <Button variant="ghost" onClick={runHealth} disabled={checking || !initial.configured}>
            {checking ? 'checking…' : 'run preflight'}
          </Button>
        </div>

        {!initial.configured && (
          <p className="text-xs text-muted-foreground italic">
            Save credentials above first.
          </p>
        )}

        {initial.configured && !health && !checking && (
          <p className="text-xs text-muted-foreground italic">
            Click <em>run preflight</em> to validate the stored credentials against the
            Telegram Bot API.
          </p>
        )}

        {health && <PreflightResult health={health} />}
        {health?.polling && <PollingState polling={health.polling} />}
      </section>

      {initial.configured && <OwnerPairingCard />}
      {initial.configured && <AccessControlCard />}
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Telegram?"
        description={
          <p>
            This permanently removes the saved bot token and supergroup ID. Telegram polling,
            ingress, and outbound delivery stop until new credentials are saved and pairing is
            completed again.
          </p>
        }
        confirmLabel="clear credentials and disconnect"
        onConfirm={async () => {
          try {
            await disconnect()
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={setConfirmDisconnect}
      />
    </ConfigPage>
  )
}

function OwnerPairingCard() {
  const [status, setStatus] = useState<TelegramPairingStatus | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const load = async () => {
    const res = await fetch('/api/config/telegram/pairing')
    if (!res.ok) throw new Error(res.statusText)
    setStatus((await res.json()) as TelegramPairingStatus)
  }
  useEffect(() => {
    void load().catch((e) => setErr((e as Error).message))
  }, [])
  async function createChallenge() {
    setErr(null)
    const res = await fetch('/api/config/telegram/pairing/challenge', { method: 'POST' })
    const body = (await res.json().catch(() => ({}))) as Partial<TelegramPairingChallenge> & {
      error?: string
    }
    if (!res.ok || !body.code) return setErr(body.error ?? res.statusText)
    setCode(body.code)
    setStatus(body as TelegramPairingChallenge)
  }
  async function cancelChallenge() {
    const res = await fetch('/api/config/telegram/pairing/challenge', { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? 'Could not cancel the pairing code')
    }
    setCode(null)
    await load()
  }
  async function resetOwner() {
    const res = await fetch('/api/config/telegram/pairing/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? 'Could not reset Telegram owner')
    }
    setCode(null)
    await load()
  }
  return (
    <section className="rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        Owner pairing
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Telegram stays closed until one owner consumes a short-lived code in the configured{' '}
        <code className="font-mono">⚙ bazilion</code> service topic.
      </p>
      {status?.paired ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-success">✓ owner paired</span>
          <Button variant="danger" onClick={() => setConfirmReset(true)}>reset owner</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-warning">Unpaired — all Telegram ingress is closed.</p>
          {code ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              Send <code className="font-mono">/pair {code}</code> in the service topic. This code
              is shown once and expires in ten minutes.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={createChallenge}>generate pairing code</Button>
            {status?.challengeActive && <Button variant="ghost" onClick={() => void cancelChallenge().catch((error) => setErr(error instanceof Error ? error.message : String(error)))}>cancel code</Button>}
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      <ConfirmDialog
        open={confirmReset}
        title="Revoke the paired Telegram owner?"
        description={
          <p>
            This immediately revokes the current owner and closes all Telegram ingress. No one can
            use the bot until a new one-time pairing code is generated and consumed.
          </p>
        }
        confirmLabel="revoke owner and close ingress"
        onConfirm={async () => {
          try {
            await resetOwner()
          } catch (error) {
            setErr(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={setConfirmReset}
      />
    </section>
  )
}

function AccessControlCard() {
  const [users, setUsers] = useState<TelegramAllowedUser[] | null>(null)
  const [userId, setUserId] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<TelegramAllowedUser | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/config/telegram/acl')
      if (!res.ok) throw new Error(res.statusText)
      setUsers((await res.json()) as TelegramAllowedUser[])
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const id = Number(userId)
    if (!Number.isInteger(id)) {
      setErr('user id must be an integer')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/config/telegram/acl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: id, label: label.trim() || null }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? res.statusText)
      }
      setUserId('')
      setLabel('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setErr(null)
    const res = await fetch(`/api/config/telegram/acl/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error ?? res.statusText)
    }
    await load()
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        Access control
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Allowlisted Telegram users can use the bot (commands + chat). An empty list is closed;
        ownership begins only through the one-time pairing flow. Users find their id via{' '}
        <code className="font-mono">/whoami</code>.
      </p>

      {users === null ? (
        <p className="text-xs text-muted-foreground italic">loading…</p>
      ) : users.length === 0 ? (
        <p className="text-xs text-warning mb-3">
          Closed — no paired owner or allowlisted members.
        </p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {users.map((u) => (
            <li key={u.userId} className="flex flex-wrap items-center gap-2">
              <code className="font-mono">{u.userId}</code>
              <span className="text-muted-foreground">
                {u.label ?? (u.username ? `@${u.username}` : '—')} · {u.role}
              </span>
              {u.role !== 'owner' && (
                <Button variant="danger" className="text-xs" onClick={() => setRemoveTarget(u)}>
                  remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="m-0 flex flex-col gap-1 text-xs font-medium text-foreground">
          Telegram user ID
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="123456789"
            inputMode="numeric"
            className="w-full rounded-md border bg-background px-2 py-1 font-mono text-sm sm:w-32"
          />
        </label>
        <label className="m-0 flex flex-col gap-1 text-xs font-medium text-foreground">
          Label <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Pat"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm sm:w-40"
          />
        </label>
        <Button variant="ghost" type="submit" disabled={busy}>
          add
        </Button>
        {err && <span role="alert" className="text-xs text-danger">{err}</span>}
      </form>
      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove ${removeTarget?.label ?? removeTarget?.username ?? removeTarget?.userId ?? ''}?`}
        description={
          <p>
            Telegram user <code className="font-mono">{removeTarget?.userId}</code> immediately
            loses command and chat access. Their Telegram account is not changed, and they can be
            allowlisted again later.
          </p>
        }
        confirmLabel="remove Telegram access"
        onConfirm={async () => {
          if (!removeTarget) return
          try {
            await remove(removeTarget.userId)
          } catch (error) {
            setErr(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      />
    </section>
  )
}

function MigrationBanner({ toChatId }: { toChatId: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function reconnect() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/config/telegram/reconnect', { method: 'POST' })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? res.statusText)
      }
      window.location.reload()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="rounded-md border-2 border-danger/25 bg-danger/10 px-4 py-3 text-sm">
      <div className="font-semibold text-danger mb-1">Supergroup chat id changed</div>
      <p className="text-danger mb-2">
        Telegram migrated this supergroup to a new chat id (
        <code className="font-mono">{toChatId}</code>). The bot is still pointed at the old id.
        Reconnect to repoint it and re-create the <code className="font-mono">⚙ bazilion</code>{' '}
        service chat in the new team. Agent topic bindings will reconcile on next use.
      </p>
      <Button variant="primary" onClick={reconnect} disabled={busy}>
        {busy ? 'reconnecting…' : `Reconnect to ${toChatId}`}
      </Button>
      {err && <span role="alert" className="ml-3 text-xs text-danger">{err}</span>}
    </div>
  )
}

function PollingState({ polling }: { polling: NonNullable<TelegramHealth['polling']> }) {
  const startedAt = polling.startedAt ? new Date(polling.startedAt).toISOString() : null
  const lastPoll = polling.lastSuccessfulPollAt
    ? new Date(polling.lastSuccessfulPollAt).toISOString()
    : null
  return (
    <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
      <p className="font-semibold uppercase tracking-wide text-muted-foreground">
        Polling state
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
        <span className={polling.running ? 'text-success' : 'text-danger'}>
          {polling.running ? 'running' : 'stopped'}
        </span>
        <span className={polling.activated ? 'text-success' : 'text-warning'}>
          {polling.activated ? 'activated' : 'awaiting activation'}
        </span>
        {polling.lastUpdateId !== null && <span>last update {polling.lastUpdateId}</span>}
        {startedAt && <span>started {startedAt}</span>}
        {lastPoll && <span>last poll {lastPoll}</span>}
      </div>
      {polling.error && <p role="alert" className="text-danger">error: {polling.error}</p>}
    </div>
  )
}

function PreflightResult({ health }: { health: TelegramHealth }) {
  if (health.error) {
    return (
      <div role="alert" className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm">
        <p className="font-semibold text-danger">
          Failed at <code className="font-mono">{health.error.step}</code>
        </p>
        <p className="text-danger mt-1">{health.error.message}</p>
        {hintFor(health.error.step)}
      </div>
    )
  }

  if (!health.preflight) {
    return <p role="status" className="text-xs text-muted-foreground italic">No preflight data.</p>
  }

  const p = health.preflight
  return (
    <ul role="status" aria-live="polite" aria-atomic="true" className="space-y-1.5">
      <Check ok={p.botUsername.length > 0} label="Bot identity">
        @{p.botUsername}
      </Check>
      <Check ok={p.chatTitle.length > 0} label="Supergroup reachable">
        {p.chatTitle}
      </Check>
      <Check ok={p.isForum} label="Forum topics enabled">
        {p.isForum
          ? 'is_forum: true'
          : 'is_forum: false — the supergroup owner must enable Topics in team settings'}
      </Check>
      <Check ok={p.hasManageTopics} label="Bot has can_manage_topics">
        {p.hasManageTopics
          ? 'admin with can_manage_topics'
          : 'promote the bot to admin in the supergroup with the "Manage topics" permission'}
      </Check>
      <Check ok={p.privacyModeOff} label="Privacy Mode is OFF">
        {p.privacyModeOff
          ? 'can_read_all_group_messages: true'
          : 'BotFather → /mybots → select bot → Bot Settings → Team Privacy → Turn off'}
      </Check>
      <Check ok={p.chatIsPrivate} label="Supergroup is private">
        {p.chatIsPrivate ? 'no public @username' : 'public groups expose topic content to readers'}
      </Check>
      <Check ok={p.memberCount === 2} label="Expected membership">
        {p.memberCount === null
          ? 'member count unavailable — verify one owner plus the bot manually'
          : `${p.memberCount} members reported; secure posture is one owner plus the bot`}
      </Check>
      {p.ownerPresent !== null && (
        <Check ok={p.ownerPresent} label="Paired owner is present">
          {p.ownerPresent ? 'owner membership confirmed' : 'owner missing — Telegram ingress is degraded'}
        </Check>
      )}
    </ul>
  )
}

function Check({
  ok,
  label,
  children,
}: {
  ok: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none ${
          ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        }`}
        aria-hidden
      >
        {ok ? '✓' : '✕'}
      </span>
      <div>
        <span className="font-medium">{label}</span>
        <span className={`ml-2 text-xs ${ok ? 'text-muted-foreground' : 'text-danger'}`}>
          {children}
        </span>
      </div>
    </li>
  )
}

function hintFor(step: 'getMe' | 'getChat' | 'getChatMember') {
  switch (step) {
    case 'getMe':
      return (
        <p className="text-xs text-danger mt-1">
          The token is invalid or revoked. Re-issue with @BotFather → /token, or paste a
          fresh one above.
        </p>
      )
    case 'getChat':
      return (
        <p className="text-xs text-danger mt-1">
          The chat id either doesn't exist, points at a basic team (not a supergroup), or
          the bot isn't a member. Forward any message from the supergroup to the bot to
          double-check the id, then add the bot to the team.
        </p>
      )
    case 'getChatMember':
      return (
        <p className="text-xs text-danger mt-1">
          The bot is in the chat but the membership lookup failed. Usually means the bot was
          kicked or the chat id was migrated — confirm the bot is still in the supergroup.
        </p>
      )
  }
}
