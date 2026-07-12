import type {
  CommunicationApproval,
  CommunicationApprovalDetail,
  CommunicationApprovalStatus,
} from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { RecoveryState } from '../../components/RecoveryState'
import { daemonClient } from '../../lib/daemon-client'

const loadApprovals = createServerFn({ method: 'GET' }).handler(() =>
  daemonClient().get<{ approvals: CommunicationApproval[] }>('/api/approvals?limit=100'),
)

export const Route = createFileRoute('/approvals/')({
  loader: () => loadApprovals(),
  component: ApprovalQueue,
  errorComponent: ({ error, reset }) => (
    <RecoveryState title="Approval queue unavailable" error={error} reset={reset} fallbackHref="/" />
  ),
})

function ApprovalQueue() {
  const initial = Route.useLoaderData()
  const [approvals, setApprovals] = useState(initial.approvals)
  const [status, setStatus] = useState<CommunicationApprovalStatus | 'all'>('pending')
  const [selected, setSelected] = useState<CommunicationApprovalDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = approvals.filter((item) => status === 'all' || item.status === status)

  const refresh = async () => {
    const response = await fetch('/api/approvals?limit=100')
    if (!response.ok) throw new Error(`Could not refresh approvals (${response.status})`)
    setApprovals(((await response.json()) as { approvals: CommunicationApproval[] }).approvals)
  }
  const inspect = async (id: string) => {
    const response = await fetch(`/api/approvals/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`Could not load approval (${response.status})`)
    setSelected((await response.json()) as CommunicationApprovalDetail)
  }
  const decide = async (action: 'approve' | 'deny') => {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(
        `/api/approvals/${encodeURIComponent(selected.id)}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: action === 'deny' ? 'Denied by operator' : undefined }),
        },
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? `Decision failed (${response.status})`)
      await refresh()
      await inspect(selected.id)
      setNotice(action === 'approve' ? 'Approved and delivered once.' : 'Denied.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      await refresh()
      await inspect(selected.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <h1>communication approvals</h1>
        <p className="muted">
          One durable queue for policy-protected attempts. Approval authorizes only the
          captured attempt.
        </p>
      </div>
      <label className="block max-w-xs text-sm">
        Status
        <select
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as CommunicationApprovalStatus | 'all')
          }
        >
          <option value="pending">Pending</option>
          <option value="all">All history</option>
          <option value="delivered">Delivered</option>
          <option value="denied">Denied</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
          <option value="delivery_failed">Delivery failed</option>
        </select>
      </label>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div className="overflow-x-auto rounded-lg border border-frost">
          <table className="w-full">
            <thead>
              <tr>
                <th>Status</th>
                <th>Path</th>
                <th>Origin</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${item.attemptKind} approval`}
                  onClick={() => void inspect(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') void inspect(item.id)
                  }}
                  className="cursor-pointer"
                >
                  <td><Status value={item.status} /></td>
                  <td>{endpoint(item.source)} → {endpoint(item.target)}</td>
                  <td>{item.origin}</td>
                  <td><time dateTime={new Date(item.expiresAt).toISOString()}>{formatTimestamp(item.expiresAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <p className="muted p-4">No approvals match this filter.</p>}
        </div>
        <aside className="card min-w-0" aria-label="Approval detail">
          {!selected ? (
            <p className="muted">Select an attempt to inspect its policy and audit history.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-lg">attempt detail</h2>
                <Status value={selected.status} />
              </div>
              <dl className="grid gap-3 text-sm">
                <Fact label="Attempt" value={`${selected.attemptKind}:${selected.attemptId}`} />
                <Fact label="Operation" value={selected.operation} />
                <Fact label="Path" value={`${endpoint(selected.source)} → ${endpoint(selected.target)}`} />
                <Fact label="Policy" value={selected.policyRefs.map((ref) => `${ref.teamId}@${ref.revision}`).join(', ')} />
                <Fact label="Expires" value={formatTimestamp(selected.expiresAt)} />
              </dl>
              <details>
                <summary className="cursor-pointer text-sm font-semibold">Sensitive payload</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-ivory p-2 text-xs">{JSON.stringify(selected.payload, null, 2)}</pre>
              </details>
              <div>
                <h3 className="text-sm">Audit history</h3>
                <ol className="mt-2 space-y-1 text-xs">
                  {selected.events.map((item) => (
                    <li key={item.id}>{formatTimestamp(item.createdAt)} · {item.event} · {item.actor}</li>
                  ))}
                </ol>
              </div>
              {notice && <p role="status" className="text-sm">{notice}</p>}
              {selected.status === 'pending' && (
                <div className="flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void decide('approve')}>Approve once</Button>
                  <Button variant="danger" disabled={busy} onClick={() => void decide('deny')}>Deny</Button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Status({ value }: { value: CommunicationApprovalStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${value === 'pending' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' : value === 'delivered' ? 'bg-sapphire-glow text-sapphire-deep' : 'bg-rose-baziu/10 text-chocolate'}`}>{value.replace('_', ' ')}</span>
}

function endpoint(value: CommunicationApproval['source']): string {
  return value.kind === 'agent' ? `Agent ${value.id}` : value.kind === 'user' ? 'User' : `Outside ${value.teamId}`
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase text-mocha-light">{label}</dt><dd className="break-all">{value}</dd></div>
}

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

function formatTimestamp(value: number): string {
  return `${timestampFormatter.format(new Date(value))} UTC`
}
