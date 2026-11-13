import type { AgentTrigger, CreateTriggerRequest, ListTriggersResponse } from '@bazilion/api-types'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ItemList, ItemRow, SectionCard } from '../../../components/Page'
import { api, errorMessage } from '../../../lib/api'
import { daemonClient } from '../../../lib/daemon-client'

const agentRoute = getRouteApi('/agents/$id')

const fetchTriggers = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(({ data }) =>
    daemonClient().get<ListTriggersResponse>(`/api/agents/${encodeURIComponent(data.id)}/triggers`),
  )

export const Route = createFileRoute('/agents/$id/triggers')({
  loader: ({ params }) => fetchTriggers({ data: { id: params.id } }),
  component: TriggersPage,
})

function TriggersPage() {
  const { agent } = agentRoute.useLoaderData()
  const { triggers, dispatches } = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<AgentTrigger | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggle(trigger: AgentTrigger) {
    setBusyId(trigger.id)
    setError(null)
    try {
      await api(`/api/triggers/${encodeURIComponent(trigger.id)}`, {
        method: 'PATCH',
        body: { enabled: !trigger.enabled },
      })
      await router.invalidate()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <AddTriggerForm agentId={agent.id} onAdded={() => router.invalidate()} />
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}

      <SectionCard title="Triggers">
        {triggers.length === 0 ? (
          <p className="muted">No triggers yet; add one above.</p>
        ) : (
          <ItemList>
            {triggers.map((trigger) => (
              <ItemRow
                key={trigger.id}
                className={trigger.enabled ? '' : 'opacity-60'}
                title={
                  <code>
                    {trigger.kind === 'interval'
                      ? `every ${trigger.intervalSec}s`
                      : trigger.cronExpr}
                  </code>
                }
                meta={
                  <>
                    <span>{trigger.kind}</span>
                    <span>
                      last fired{' '}
                      {trigger.lastFiredAt
                        ? new Date(trigger.lastFiredAt).toLocaleString()
                        : 'never'}
                    </span>
                    <code className="break-all">{trigger.id}</code>
                  </>
                }
                actions={
                  <>
                    <Button
                      variant="ghost"
                      disabled={busyId === trigger.id}
                      onClick={() => void toggle(trigger)}
                    >
                      {busyId === trigger.id ? 'Working…' : trigger.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busyId === trigger.id}
                      onClick={() => setDeleteTarget(trigger)}
                    >
                      Delete
                    </Button>
                  </>
                }
              >
                <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-sm">
                  {trigger.message}
                </p>
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SectionCard>

      <SectionCard title="Recent runs">
        {dispatches.length === 0 ? (
          <p className="muted">No scheduled occurrences yet.</p>
        ) : (
          <ItemList>
            {dispatches.map((dispatch) => (
              <ItemRow
                key={dispatch.id}
                title={new Date(dispatch.scheduledAt).toLocaleString()}
                meta={<code>{dispatch.status}</code>}
              >
                {dispatch.error && (
                  <p className="mb-0 mt-1 break-words text-sm text-danger">{dispatch.error}</p>
                )}
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SectionCard>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.kind ?? ''} trigger?`}
        description={
          <p>
            This permanently removes trigger <code className="font-mono">{deleteTarget?.id}</code>,
            its run history, and every future scheduled occurrence for {agent.name}. The Agent
            itself is not deleted.
          </p>
        }
        confirmLabel="Delete trigger and history"
        onConfirm={async () => {
          if (!deleteTarget) return
          await api(`/api/triggers/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
          await router.invalidate()
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </div>
  )
}

function AddTriggerForm({ agentId, onAdded }: { agentId: string; onAdded: () => void }) {
  const [kind, setKind] = useState<'interval' | 'cron'>('interval')
  const [intervalSec, setIntervalSec] = useState(300)
  const [cronExpr, setCronExpr] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const request: CreateTriggerRequest =
        kind === 'interval'
          ? { kind, intervalSec, message: message.trim() }
          : { kind, cronExpr: cronExpr.trim(), message: message.trim() }
      await api(`/api/agents/${encodeURIComponent(agentId)}/triggers`, { body: request })
      setMessage('')
      setCronExpr('')
      setIntervalSec(300)
      onAdded()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SectionCard title="Add trigger">
      <form onSubmit={(event) => void submit(event)}>
        <div className="mb-3 flex flex-wrap gap-4">
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
            Interval (seconds)
            <input
              type="number"
              min={1}
              required
              value={intervalSec}
              onChange={(event) => setIntervalSec(Number(event.target.value))}
            />
          </label>
        ) : (
          <label>
            Cron expression (minute hour day-of-month month day-of-week)
            <input
              type="text"
              required
              placeholder="*/15 * * * *"
              value={cronExpr}
              onChange={(event) => setCronExpr(event.target.value)}
            />
          </label>
        )}
        <label>
          Message
          <textarea
            required
            placeholder="e.g. check your inbox and act on anything new"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-[80px] font-mono text-[0.9em]"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add trigger'}
          </Button>
          {error && (
            <span role="alert" className="text-[0.85em] text-danger">
              {error}
            </span>
          )}
        </div>
      </form>
    </SectionCard>
  )
}
