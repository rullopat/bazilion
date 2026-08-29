import { ApiClientError } from '@bazilion/client'
import type { AgentTrigger, ResolvedAgent, TriggerDispatch } from '@bazilion/api-types'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { AgentTabs } from '../../../components/AgentTabs'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { PageShell } from '../../../components/Page'
import { daemonClient } from '../../../lib/daemon-client'

interface TriggersView {
  resolved: ResolvedAgent
  triggers: AgentTrigger[]
  dispatches: TriggerDispatch[]
}

const fetchTriggers = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<TriggersView | null> => {
    const c = daemonClient()
    let resolved: ResolvedAgent
    try {
      resolved = await c.get<ResolvedAgent>(`/api/agents/${encodeURIComponent(data.id)}`)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) return null
      throw err
    }
    const { triggers, dispatches } = await c.get<{
      triggers: AgentTrigger[]
      dispatches: TriggerDispatch[]
    }>(
      `/api/agents/${encodeURIComponent(resolved.agent.id)}/triggers`,
    )
    return { resolved, triggers, dispatches }
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
  const { resolved, triggers, dispatches } = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<AgentTrigger | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggle(t: AgentTrigger) {
    setBusyId(t.id)
    setMutationError(null)
    try {
      const response = await fetch(`/api/triggers/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !t.enabled }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Could not ${t.enabled ? 'disable' : 'enable'} trigger`)
      }
      await router.invalidate()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }
  async function del(id: string) {
    const response = await fetch(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 204) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? 'Could not delete trigger')
    }
    await router.invalidate()
  }

  return (
    <PageShell>
      <header className="mb-6">
        <h1>{resolved.agent.name}</h1>
      </header>
      <AgentTabs
        agentId={resolved.agent.id}
        active="triggers"
        archived={resolved.agent.status === 'archived'}
      />

      <AddTriggerForm agentId={resolved.agent.id} onAdded={() => router.invalidate()} />
      {mutationError && (
        <p role="alert" className="err mt-4">
          {mutationError}
        </p>
      )}

      <h3 className="mb-3 mt-6 font-body text-[0.85em] font-semibold uppercase tracking-wider text-mocha-light">
        Active triggers
      </h3>

      {triggers.length === 0 ? (
        <p className="muted">no triggers yet — add one above.</p>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {triggers.map((t) => {
              const spec = t.kind === 'interval' ? `every ${t.intervalSec}s` : t.cronExpr
              const last = t.lastFiredAt ? new Date(t.lastFiredAt).toLocaleString() : 'Never'
              return (
                <article
                  key={t.id}
                  className={`card min-w-0 ${t.enabled ? '' : 'opacity-60'}`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 break-all font-mono text-xs text-muted-foreground">
                        {t.id}
                      </p>
                      <p className="mb-0 mt-1 font-medium text-foreground">{spec}</p>
                    </div>
                    <span className="shrink-0 rounded-sm border border-frost bg-ivory px-2 py-0.5 font-mono text-xs text-mocha">
                      {t.kind}
                    </span>
                  </div>
                  <p className="my-3 break-words text-sm text-foreground">{t.message}</p>
                  <p className="mb-3 text-xs text-muted-foreground">Last fired: {last}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      disabled={busyId === t.id}
                      onClick={() => void toggle(t)}
                    >
                      {busyId === t.id ? 'Working…' : t.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busyId === t.id}
                      onClick={() => {
                        setMutationError(null)
                        setDeleteTarget(t)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full">
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
                      <td><code>{t.id.slice(0, 8)}…</code></td>
                      <td>
                        <span className="inline-block rounded-sm border border-frost bg-ivory px-2 py-0.5 font-mono text-[0.8em] text-mocha">
                          {t.kind}
                        </span>
                      </td>
                      <td><code>{spec}</code></td>
                      <td>{t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message}</td>
                      <td className="text-[0.82em] text-mocha-light">{last}</td>
                      <td>
                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            disabled={busyId === t.id}
                            onClick={() => void toggle(t)}
                          >
                            {busyId === t.id ? 'working…' : t.enabled ? 'disable' : 'enable'}
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busyId === t.id}
                            onClick={() => {
                              setMutationError(null)
                              setDeleteTarget(t)
                            }}
                          >
                            delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mb-3 mt-8 font-body text-[0.85em] font-semibold uppercase tracking-wider text-mocha-light">
        Recent dispatches
      </h3>
      {dispatches.length === 0 ? (
        <p className="muted">no scheduled occurrences yet.</p>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {dispatches.map((dispatch) => (
              <article key={dispatch.id} className="card min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <time className="text-sm text-foreground">
                    {new Date(dispatch.scheduledAt).toLocaleString()}
                  </time>
                  <code className="shrink-0">{dispatch.status}</code>
                </div>
                <p className="mb-0 mt-2 text-xs text-muted-foreground">
                  {dispatch.attemptCount} attempt{dispatch.attemptCount === 1 ? '' : 's'}
                </p>
                {dispatch.lastError && (
                  <p className="mb-0 mt-2 break-words text-sm text-danger">{dispatch.lastError}</p>
                )}
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th>scheduled</th>
                  <th>status</th>
                  <th>attempts</th>
                  <th>error</th>
                </tr>
              </thead>
              <tbody>
                {dispatches.map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td className="text-[0.82em]">
                      {new Date(dispatch.scheduledAt).toLocaleString()}
                    </td>
                    <td><code>{dispatch.status}</code></td>
                    <td>{dispatch.attemptCount}</td>
                    <td className="text-[0.82em] text-mocha-light">
                      {dispatch.lastError ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.kind ?? ''} trigger?`}
        description={
          <p>
            This permanently removes trigger{' '}
            <code className="font-mono">{deleteTarget?.id}</code>, its recorded dispatch history,
            and every future scheduled occurrence for {resolved.agent.name}. The Agent itself is
            not deleted.
          </p>
        }
        confirmLabel="delete trigger and history"
        onConfirm={async () => {
          if (!deleteTarget) return
          try {
            await del(deleteTarget.id)
          } catch (error) {
            setMutationError(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </PageShell>
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
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? 'adding…' : 'add'}
        </Button>
        {err && <span role="alert" className="text-[0.85em] text-danger">{err}</span>}
      </div>
    </form>
  )
}
