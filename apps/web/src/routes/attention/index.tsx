import type { AttentionItem, AttentionKind, AttentionListResponse, AttentionState, AttentionSummary } from '@bazilion/api-types'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { EmptyState, PageHeader, PageShell, SectionCard, StatusBadge } from '../../components/Page'
import { RecoveryState } from '../../components/RecoveryState'
import { daemonClient } from '../../lib/daemon-client'

const loadAttention = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [list, summary] = await Promise.all([
    client.get<AttentionListResponse>('/api/attention?state=all&limit=200'),
    client.get<AttentionSummary>('/api/attention/summary'),
  ])
  return { list, summary }
})

export const Route = createFileRoute('/attention/')({
  loader: () => loadAttention(), component: AttentionCenter,
  errorComponent: ({ error, reset }) => <RecoveryState title="Attention Center unavailable" error={error} reset={reset} fallbackHref="/" />,
})

function AttentionCenter() {
  const initial = Route.useLoaderData()
  const [items, setItems] = useState(initial.list.items)
  const [degraded, setDegraded] = useState(initial.list.degraded)
  const [summary, setSummary] = useState(initial.summary)
  const [state, setState] = useState<AttentionState>('open')
  const [kind, setKind] = useState<AttentionKind | 'all'>('all')
  const [severity, setSeverity] = useState<'all' | AttentionItem['severity']>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = useMemo(() => items.filter((item) => (state === 'all' || (state === 'open' ? item.acknowledgedAt === null : item.acknowledgedAt !== null)) && (kind === 'all' || item.kind === kind) && (severity === 'all' || item.severity === severity)), [items, kind, severity, state])

  async function refresh() {
    const [listResponse, summaryResponse] = await Promise.all([fetch('/api/attention?state=all&limit=200'), fetch('/api/attention/summary')])
    if (!listResponse.ok || !summaryResponse.ok) throw new Error('Could not refresh the Attention Center')
    const list = await listResponse.json() as AttentionListResponse
    setItems(list.items); setDegraded(list.degraded); setSummary(await summaryResponse.json() as AttentionSummary)
  }
  async function acknowledge(item: AttentionItem, value: boolean) {
    setBusy(item.key); setNotice(null)
    try {
      const response = await fetch(`/api/attention/${encodeURIComponent(item.key)}/${value ? 'acknowledge' : 'acknowledgement'}`, { method: value ? 'POST' : 'DELETE' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `Update failed (${response.status})`)
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); await refresh().catch(() => {}) } finally { setBusy(null) }
  }
  async function acknowledgeAll() {
    setBusy('all'); setNotice(null)
    try { const response = await fetch('/api/attention/acknowledge-all', { method: 'POST' }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Acknowledgement failed'); setNotice(`Acknowledged ${body.acknowledged} informational item(s). Approvals and lessons were left open.`); await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } finally { setBusy(null) }
  }

  return <PageShell size="wide">
    <PageHeader eyebrow="Operations" title="Attention Center" description="One queue for decisions and terminal signals. Resolve action-required work at its canonical source; acknowledge informational failures here." actions={<Button variant="ghost" disabled={busy !== null} onClick={() => void acknowledgeAll()}>Acknowledge all informational items</Button>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><Count label="Open" value={summary.openTotal} /><Count label="Action required" value={summary.bySeverity.action_required} /><Count label="Errors and warnings" value={summary.bySeverity.error + summary.bySeverity.warning} /></div>
    {(degraded.length > 0 || summary.degraded.length > 0) && <div role="alert" className="mb-5 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm"><strong>Partial results.</strong> {[...new Set([...degraded, ...summary.degraded].map((item) => item.kind))].join(', ')} could not be loaded.</div>}
    {notice && <p role="status" className="mb-5 rounded-lg bg-muted px-4 py-3 text-sm">{notice}</p>}
    <SectionCard title="Queue" description={`${visible.length} matching item${visible.length === 1 ? '' : 's'}`} actions={<div className="flex flex-wrap gap-2"><select aria-label="Queue state" value={state} onChange={(e) => setState(e.target.value as AttentionState)}><option value="open">Open</option><option value="acknowledged">History</option><option value="all">All</option></select><select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}><option value="all">All severities</option><option value="action_required">Action required</option><option value="error">Errors</option><option value="warning">Warnings</option></select><select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="all">All kinds</option><option value="communication_approval">Approvals</option><option value="lesson_proposal">Lessons</option><option value="review_failure">Review failures</option><option value="trigger_failure">Trigger failures</option><option value="agent_loop_break">Loop breaks</option></select></div>}>
      {visible.length === 0 ? <EmptyState title={state === 'open' ? 'Nothing needs attention' : 'No matching history'} description="The queue updates from Bazilion's canonical approvals, learning, triggers, and loop diagnostics." /> : <div className="grid gap-3">{visible.map((item) => <article key={item.key} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><StatusBadge variant={item.severity === 'action_required' ? 'warning' : item.severity === 'error' ? 'danger' : 'info'}>{item.severity.replace('_', ' ')}</StatusBadge><span className="text-xs text-muted-foreground">{item.kind.replaceAll('_', ' ')}</span></div><h3 className="mt-2 text-base">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.diagnostic}</p><p className="mt-2 text-xs text-muted-foreground">{[item.agentName, item.teamName].filter(Boolean).join(' · ') || 'System'} · <time dateTime={new Date(item.occurredAt).toISOString()}>{new Date(item.occurredAt).toLocaleString()}</time></p></div><div className="flex shrink-0 flex-wrap gap-2"><Link to={item.href} className="btn-primary">{item.kind === 'communication_approval' ? 'Review approval' : item.kind === 'lesson_proposal' ? 'Review lesson' : 'Inspect source'}</Link>{item.acknowledgeable && <Button variant="ghost" disabled={busy === item.key} onClick={() => void acknowledge(item, item.acknowledgedAt === null)}>{item.acknowledgedAt === null ? 'Acknowledge' : 'Restore to open'}</Button>}</div></div></article>)}</div>}
    </SectionCard>
  </PageShell>
}

function Count({ label, value }: { label: string; value: number }) { return <div className="card p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div> }
