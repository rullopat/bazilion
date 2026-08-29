import type {
  CommunicationApproval,
  CommunicationApprovalDetail,
  CommunicationApprovalStatus,
} from '@bazilion/api-types'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import {
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
  type StatusBadgeVariant,
} from '../../components/Page'
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
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error(`Could not load approval (${response.status})`)
      setSelected((await response.json()) as CommunicationApprovalDetail)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
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
    <PageShell size="wide">
      <PageHeader
        eyebrow="Policy operations"
        title="Communication approvals"
        description="One durable queue for policy-protected attempts. Approval authorizes only the captured attempt."
        actions={
          <label className="m-0 block w-full text-sm sm:w-52">
            Status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as CommunicationApprovalStatus | 'all')
              }
              className="mt-1"
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
        }
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <SectionCard
          title="Approval queue"
          description={`${visible.length} matching attempt${visible.length === 1 ? '' : 's'}`}
          className="min-w-0"
        >
          {visible.length === 0 ? (
            <EmptyState
              title="No matching approvals"
              description="Try another status filter or return when a protected attempt needs review."
            />
          ) : (
            <>
            <div className="hidden overflow-x-auto md:block">
              <table className="m-0 min-w-[680px]">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Path</th>
                    <th>Origin</th>
                    <th>Expires</th>
                    <th><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => void inspect(item.id)}
                      className={`cursor-pointer ${selected?.id === item.id ? 'bg-accent/60' : ''}`}
                    >
                      <td>
                        <Status value={item.status} />
                      </td>
                      <td className="min-w-56">
                        {endpoint(item.source)} → {endpoint(item.target)}
                      </td>
                      <td>{item.origin}</td>
                      <td className="whitespace-nowrap">
                        <time dateTime={new Date(item.expiresAt).toISOString()}>
                          {formatTimestamp(item.expiresAt)}
                        </time>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          aria-pressed={selected?.id === item.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            void inspect(item.id)
                          }}
                        >
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Inspect ${item.attemptKind} approval`}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => void inspect(item.id)}
                  className={`unstyled min-w-0 rounded-xl border p-4 text-left ${
                    selected?.id === item.id
                      ? 'border-primary/40 bg-accent/60'
                      : 'border-border bg-muted/20'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Status value={item.status} />
                    <time
                      dateTime={new Date(item.expiresAt).toISOString()}
                      className="text-xs text-muted-foreground"
                    >
                      {formatTimestamp(item.expiresAt)}
                    </time>
                  </div>
                  <div className="mt-3 break-words text-sm font-semibold text-foreground">
                    {endpoint(item.source)} → {endpoint(item.target)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Origin: {item.origin}
                  </div>
                </button>
              ))}
            </div>
            </>
          )}
        </SectionCard>

        <aside className="min-w-0" aria-label="Approval details">
          <SectionCard
            title="Attempt details"
            actions={selected ? <Status value={selected.status} /> : undefined}
          >
            {!selected ? (
              <EmptyState
                title="No attempt selected"
                description="Select an attempt from the queue to inspect its policy and audit history."
                className="min-h-56"
              />
            ) : (
              <div className="space-y-5">
                <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <Fact label="Attempt" value={`${selected.attemptKind}:${selected.attemptId}`} />
                  <Fact label="Operation" value={selected.operation} />
                  <Fact
                    label="Path"
                    value={`${endpoint(selected.source)} → ${endpoint(selected.target)}`}
                  />
                  <Fact
                    label="Policy"
                    value={selected.policyRefs
                      .map((ref) => `${ref.teamId}@${ref.revision}`)
                      .join(', ')}
                  />
                  <Fact label="Expires" value={formatTimestamp(selected.expiresAt)} />
                </dl>
                <details className="rounded-lg border border-border bg-muted/30 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Sensitive payload
                  </summary>
                  <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-background p-3 text-xs">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </details>
                <div>
                  <h3 className="m-0 font-body text-sm font-semibold text-foreground">
                    Audit history
                  </h3>
                  <ol className="mt-2 divide-y divide-border rounded-lg border border-border text-xs">
                    {selected.events.map((item) => (
                      <li key={item.id} className="px-3 py-2 leading-5">
                        {formatTimestamp(item.createdAt)} · {item.event} · {item.actor}
                      </li>
                    ))}
                  </ol>
                </div>
                {notice && (
                  <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
                    {notice}
                  </p>
                )}
                {selected.status === 'pending' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void decide('approve')}
                    >
                      Approve once
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void decide('deny')}
                    >
                      Deny
                    </Button>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </aside>
      </div>
    </PageShell>
  )
}

function Status({ value }: { value: CommunicationApprovalStatus }) {
  return <StatusBadge variant={statusVariant(value)}>{statusLabel(value)}</StatusBadge>
}

function statusVariant(value: CommunicationApprovalStatus): StatusBadgeVariant {
  switch (value) {
    case 'pending':
      return 'warning'
    case 'approved':
    case 'delivering':
      return 'info'
    case 'delivered':
      return 'success'
    case 'denied':
    case 'delivery_failed':
      return 'danger'
    case 'expired':
    case 'cancelled':
      return 'neutral'
  }
}

function statusLabel(value: CommunicationApprovalStatus): string {
  const label = value.replaceAll('_', ' ')
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function endpoint(value: CommunicationApproval['source']): string {
  return value.kind === 'agent' ? `Agent ${value.id}` : value.kind === 'user' ? 'User' : `Outside ${value.teamId}`
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-all text-foreground">{value}</dd>
    </div>
  )
}

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

function formatTimestamp(value: number): string {
  return `${timestampFormatter.format(new Date(value))} UTC`
}
