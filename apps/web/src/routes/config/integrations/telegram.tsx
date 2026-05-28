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
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfigTabs } from '../../../components/ConfigTabs'
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

  const [health, setHealth] = useState<TelegramHealth | null>(null)
  const [checking, setChecking] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
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
    if (!confirm('Clear the saved Telegram credentials?')) return
    try {
      await fetch('/api/config/telegram', { method: 'DELETE' })
      setToken('')
      setChatId('')
      setHealth(null)
      setSaveOk(false)
      setSaveError(null)
      await router.invalidate()
    } catch (e) {
      setSaveError((e as Error).message)
    }
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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-serif text-3xl text-foreground mb-2">config</h1>
      <ConfigTabs active="integrations" />

      <header className="mb-6">
        <h2 className="text-xl font-semibold">Telegram</h2>
        <p className="text-muted-foreground text-sm">
          One forum-supergroup bot, one topic per agent. Talk to any of your agents from a
          phone.
        </p>
      </header>

      <Step2Banner />

      {initial.migratedChatId && <MigrationBanner toChatId={initial.migratedChatId} />}

      <section className="rounded-lg border bg-card p-5 mb-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Credentials
        </h3>

        {initial.configured && (
          <p className="text-xs text-emerald-700 mb-3">
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
              onChange={(e) => setToken(e.target.value)}
              placeholder={initial.configured ? '(leave blank to keep stored value)' : '1234567890:ABC...'}
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
              required={!initial.configured}
            />
            <p className="text-xs text-muted-foreground mt-1">
              From @BotFather → /newbot. Disable Privacy Mode in <em>Bot Settings → Group
              Privacy → Turn off</em>.
            </p>
          </label>

          <label className="block">
            <span className="block text-sm font-medium mb-1">Supergroup chat ID</span>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
              className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Forum-enabled supergroup the bot is admin in (with{' '}
              <code className="font-mono">can_manage_topics</code>).
            </p>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'saving…' : 'save credentials'}
            </Button>
            {initial.configured && (
              <Button variant="danger" onClick={disconnect}>
                clear credentials
              </Button>
            )}
            {saveOk && <span className="text-xs text-emerald-700">saved ✓</span>}
            {saveError && <span className="text-xs text-rose-700">error: {saveError}</span>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
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

      {initial.configured && <AccessControlCard />}
    </main>
  )
}

function AccessControlCard() {
  const [users, setUsers] = useState<TelegramAllowedUser[] | null>(null)
  const [userId, setUserId] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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
    try {
      const res = await fetch(`/api/config/telegram/acl/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? res.statusText)
      }
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        Access control
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Allowlisted Telegram users can use the bot (commands + chat). While the list is empty the
        bot is open and the first person to message it becomes owner. Users find their id via{' '}
        <code className="font-mono">/whoami</code>.
      </p>

      {users === null ? (
        <p className="text-xs text-muted-foreground italic">loading…</p>
      ) : users.length === 0 ? (
        <p className="text-xs text-amber-700 mb-3">
          Open — no allowlist yet. The first user to message the bot claims owner.
        </p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {users.map((u) => (
            <li key={u.userId} className="flex items-center gap-2">
              <code className="font-mono">{u.userId}</code>
              <span className="text-muted-foreground">
                {u.label ?? (u.username ? `@${u.username}` : '—')} · {u.role}
              </span>
              {u.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => void remove(u.userId)}
                  className="ghost-btn text-xs text-[#9B3D3D]"
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="user id"
          className="w-28 rounded-md border bg-background px-2 py-1 font-mono text-sm"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label (optional)"
          className="w-40 rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Button variant="ghost" type="submit" disabled={busy}>
          add
        </Button>
        {err && <span className="text-xs text-rose-700">{err}</span>}
      </form>
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
    <div className="rounded-md border-2 border-rose-400 bg-rose-50 px-4 py-3 mb-6 text-sm">
      <div className="font-semibold text-rose-900 mb-1">Supergroup chat id changed</div>
      <p className="text-rose-900 mb-2">
        Telegram migrated this supergroup to a new chat id (
        <code className="font-mono">{toChatId}</code>). The bot is still pointed at the old id.
        Reconnect to repoint it and re-create the <code className="font-mono">⚙ bazilion</code>{' '}
        service chat in the new group. Agent topic bindings will reconcile on next use.
      </p>
      <Button variant="primary" onClick={reconnect} disabled={busy}>
        {busy ? 'reconnecting…' : `Reconnect to ${toChatId}`}
      </Button>
      {err && <span className="ml-3 text-xs text-rose-700">{err}</span>}
    </div>
  )
}

function Step2Banner() {
  return (
    <div className="rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 mb-6 text-sm">
      <div className="font-semibold text-amber-900 mb-1">Step 2 of the rollout</div>
      <p className="text-amber-900">
        The bot polls Telegram and creates the <code className="font-mono">⚙ bazilion</code>{' '}
        service chat on first start. Inbound messages are logged but not yet routed to agents —{' '}
        slash commands and per-agent topics ship in the next release. Outbound from agents ships
        after that.
      </p>
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
        <span className={polling.running ? 'text-emerald-700' : 'text-rose-700'}>
          {polling.running ? 'running' : 'stopped'}
        </span>
        <span className={polling.activated ? 'text-emerald-700' : 'text-amber-700'}>
          {polling.activated ? 'activated' : 'awaiting activation'}
        </span>
        {polling.lastUpdateId !== null && <span>last update {polling.lastUpdateId}</span>}
        {startedAt && <span>started {startedAt}</span>}
        {lastPoll && <span>last poll {lastPoll}</span>}
      </div>
      {polling.error && <p className="text-rose-700">error: {polling.error}</p>}
    </div>
  )
}

function PreflightResult({ health }: { health: TelegramHealth }) {
  if (health.error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm">
        <p className="font-semibold text-rose-900">
          Failed at <code className="font-mono">{health.error.step}</code>
        </p>
        <p className="text-rose-900 mt-1">{health.error.message}</p>
        {hintFor(health.error.step)}
      </div>
    )
  }

  if (!health.preflight) {
    return <p className="text-xs text-muted-foreground italic">No preflight data.</p>
  }

  const p = health.preflight
  return (
    <ul className="space-y-1.5">
      <Check ok={p.botUsername.length > 0} label="Bot identity">
        @{p.botUsername}
      </Check>
      <Check ok={p.chatTitle.length > 0} label="Supergroup reachable">
        {p.chatTitle}
      </Check>
      <Check ok={p.isForum} label="Forum topics enabled">
        {p.isForum
          ? 'is_forum: true'
          : 'is_forum: false — the supergroup owner must enable Topics in group settings'}
      </Check>
      <Check ok={p.hasManageTopics} label="Bot has can_manage_topics">
        {p.hasManageTopics
          ? 'admin with can_manage_topics'
          : 'promote the bot to admin in the supergroup with the "Manage topics" permission'}
      </Check>
      <Check ok={p.privacyModeOff} label="Privacy Mode is OFF">
        {p.privacyModeOff
          ? 'can_read_all_group_messages: true'
          : 'BotFather → /mybots → select bot → Bot Settings → Group Privacy → Turn off'}
      </Check>
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
          ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
        }`}
        aria-hidden
      >
        {ok ? '✓' : '✕'}
      </span>
      <div>
        <span className="font-medium">{label}</span>
        <span className={`ml-2 text-xs ${ok ? 'text-muted-foreground' : 'text-rose-800'}`}>
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
        <p className="text-xs text-rose-900 mt-1">
          The token is invalid or revoked. Re-issue with @BotFather → /token, or paste a
          fresh one above.
        </p>
      )
    case 'getChat':
      return (
        <p className="text-xs text-rose-900 mt-1">
          The chat id either doesn't exist, points at a basic group (not a supergroup), or
          the bot isn't a member. Forward any message from the supergroup to the bot to
          double-check the id, then add the bot to the group.
        </p>
      )
    case 'getChatMember':
      return (
        <p className="text-xs text-rose-900 mt-1">
          The bot is in the chat but the membership lookup failed. Usually means the bot was
          kicked or the chat id was migrated — confirm the bot is still in the supergroup.
        </p>
      )
  }
}
