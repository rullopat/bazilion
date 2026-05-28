import { ApiClientError } from '@bazilion/client'
import type { AgentTrigger, ResolvedAgent } from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentTabs } from '../../../components/AgentTabs'
import { daemonClient } from '../../../lib/daemon-client'

interface TriggersView {
  resolved: ResolvedAgent
  triggers: AgentTrigger[]
}

const fetchTriggers = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<TriggersView | null> => {
    const c = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await c.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const { triggers } = await c.get<{ triggers: AgentTrigger[] }>(
      `/api/agents/${encodeURIComponent(resolved.agent.id)}/triggers`,
    )
    return { resolved, triggers }
  })

export const Route = createFileRoute('/agents/$id/triggers')({
  loader: async ({ params }) => {
    const data = await fetchTriggers({ data: { id: params.id } })
    if (!data) throw redirect({ to: '/agents' })
    return data
  },
  component: TriggersPage,
})

function TriggersPage() {
  const { resolved, triggers } = Route.useLoaderData()
  const router = useRouter()

  async function toggle(t: AgentTrigger) {
    await fetch(`/api/triggers/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !t.enabled }),
    })
    await router.invalidate()
  }
  async function del(id: string) {
    if (!confirm('delete this trigger?')) return
    await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
    await router.invalidate()
  }

  return (
    <div>
      <header className="mb-6">
        <h1>{resolved.agent.name}</h1>
      </header>
      <AgentTabs
        agentId={resolved.agent.id}
        active="triggers"
        archived={resolved.agent.status === 'archived'}
      />

      <AddTriggerForm agentId={resolved.agent.id} onAdded={() => router.invalidate()} />

      <h3 className="mb-3 mt-6 font-body text-[0.85em] font-semibold uppercase tracking-wider text-mocha-light">
        Active triggers
      </h3>

      {triggers.length === 0 ? (
        <p className="muted">no triggers yet — add one above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>kind</th>
              <th>spec</th>
              <th>message</th>
              <th>last fired</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {triggers.map((t) => {
              const spec = t.kind === 'interval' ? `every ${t.intervalSec}s` : t.cronExpr
              const last = t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : '(never)'
              return (
                <tr key={t.id} className={t.enabled ? '' : 'opacity-60'}>
                  <td>
                    <code>{t.id.slice(0, 8)}…</code>
                  </td>
                  <td>
                    <span className="inline-block rounded-sm border border-frost bg-ivory px-2 py-0.5 font-mono text-[0.8em] text-mocha">
                      {t.kind}
                    </span>
                  </td>
                  <td>
                    <code>{spec}</code>
                  </td>
                  <td>
                    {t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message}
                  </td>
                  <td className="text-[0.82em] text-mocha-light">{last}</td>
                  <td>
                    <div className="flex gap-1.5">
                      <button type="button" className="ghost-btn" onClick={() => toggle(t)}>
                        {t.enabled ? 'disable' : 'enable'}
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => del(t.id)}>
                        delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function AddTriggerForm({
  agentId,
  onAdded,
}: {
  agentId: string
  onAdded: () => void
}) {
  const [kind, setKind] = useState<'interval' | 'cron'>('interval')
  const [intervalSec, setIntervalSec] = useState(300)
  const [cronExpr, setCronExpr] = useState('')
  const [message, setMessage] = useState('')
  const [silent, setSilent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErr(null)
    if (!message.trim()) {
      setErr('message is required')
      return
    }
    if (kind === 'interval' && (!Number.isFinite(intervalSec) || intervalSec <= 0)) {
      setErr('interval must be a positive number')
      return
    }
    if (kind === 'cron' && !cronExpr.trim()) {
      setErr('cron expression is required')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { kind, message: message.trim() }
      if (kind === 'interval') body.intervalSec = intervalSec
      else body.cronExpr = cronExpr.trim()
      if (silent) body.silentInTelegram = true
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/triggers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e2 = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(e2?.error ?? res.statusText)
      }
      setMessage('')
      setCronExpr('')
      setIntervalSec(300)
      setSilent(false)
      onAdded()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>Add trigger</h3>
      <div className="mb-3 flex gap-3">
        <label className="m-0 inline-flex cursor-pointer items-center gap-1">
          <input
            type="radio"
            checked={kind === 'interval'}
            onChange={() => setKind('interval')}
          />
          interval (every N seconds)
        </label>
        <label className="m-0 inline-flex cursor-pointer items-center gap-1">
          <input type="radio" checked={kind === 'cron'} onChange={() => setKind('cron')} />
          cron (5-field)
        </label>
      </div>
      {kind === 'interval' ? (
        <label>
          interval (seconds)
          <input
            type="number"
            min={1}
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
          />
        </label>
      ) : (
        <label>
          cron expression (minute hour dom month dow)
          <input
            type="text"
            placeholder="*/15 * * * *"
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
          />
        </label>
      )}
      <label>
        message
        <textarea
          placeholder="e.g. check your inbox and act on anything new"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="font-mono text-[0.9em] min-h-[80px]"
        />
      </label>
      <label className="m-0 mt-2 inline-flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} />
        silent in Telegram (run the turn but don't mirror it)
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={submitting}>
          {submitting ? 'adding…' : 'add'}
        </button>
        {err && <span className="text-[0.85em] text-[#9B3D3D]">{err}</span>}
      </div>
    </form>
  )
}
