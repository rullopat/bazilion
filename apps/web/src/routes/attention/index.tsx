import type {
  AttentionItem,
  AttentionKind,
  AttentionListResponse,
  AttentionState,
  AttentionSummary,
} from '@bazilion/api-types'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Button } from '../../components/Button'
import {
  EmptyState,
  ItemList,
  ItemRow,
  PageHeader,
  PageShell,
  SectionCard,
  Stat,
  StatusBadge,
} from '../../components/Page'
import { api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

const LIST_PATH = '/api/attention?state=all&limit=200'
const SUMMARY_PATH = '/api/attention/summary'

const loadAttention = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [list, summary] = await Promise.all([
    client.get<AttentionListResponse>(LIST_PATH),
    client.get<AttentionSummary>(SUMMARY_PATH),
  ])
  return { list, summary }
})

export const Route = createFileRoute('/attention/')({
  loader: () => loadAttention(),
  component: AttentionCenter,
})

const SEVERITY_BADGE = {
  action_required: 'warning',
  error: 'danger',
  warning: 'info',
} as const

function AttentionCenter() {
  const initial = Route.useLoaderData()
  const [list, setList] = useState(initial.list)
  const [summary, setSummary] = useState(initial.summary)
  const [state, setState] = useState<AttentionState>('open')
  const [kind, setKind] = useState<AttentionKind | 'all'>('all')
  const [severity, setSeverity] = useState<'all' | AttentionItem['severity']>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = list.items.filter(
    (item) =>
      (state === 'all' ||
        (state === 'open' ? item.acknowledgedAt === null : item.acknowledgedAt !== null)) &&
      (kind === 'all' || item.kind === kind) &&
      (severity === 'all' || item.severity === severity),
  )
  const degradedKinds = [
    ...new Set([...list.degraded, ...summary.degraded].map((entry) => entry.kind)),
  ]

  async function refresh() {
    const [nextList, nextSummary] = await Promise.all([
      api<AttentionListResponse>(LIST_PATH),
      api<AttentionSummary>(SUMMARY_PATH),
    ])
    setList(nextList)
    setSummary(nextSummary)
  }

  async function run(key: string, request: () => Promise<string | null>) {
    setBusy(key)
    setNotice(null)
    try {
      setNotice(await request())
    } catch (cause) {
      setNotice(errorMessage(cause))
    } finally {
      await refresh().catch(() => {})
      setBusy(null)
    }
  }

  const acknowledge = (item: AttentionItem, value: boolean) =>
    run(item.key, async () => {
      const path = `/api/attention/${encodeURIComponent(item.key)}`
      await api(value ? `${path}/acknowledge` : `${path}/acknowledgement`, {
        method: value ? 'POST' : 'DELETE',
      })
      return null
    })

  const acknowledgeAll = () =>
    run('all', async () => {
      const { acknowledged } = await api<{ acknowledged: number }>(
        '/api/attention/acknowledge-all',
        { method: 'POST' },
      )
      return `Acknowledged ${acknowledged} informational item(s). Lesson proposals and paused queues stay open.`
    })

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Operations"
        title="Attention"
        description="Decisions waiting for you and failures worth a look. Act on an item at its source; acknowledge informational ones here."
        actions={
          <Button variant="ghost" disabled={busy !== null} onClick={() => void acknowledgeAll()}>
            Acknowledge all informational items
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={summary.openTotal} />
        <Stat label="Action required" value={summary.bySeverity.action_required} />
        <Stat
          label="Errors and warnings"
          value={summary.bySeverity.error + summary.bySeverity.warning}
        />
      </div>
      {degradedKinds.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
          <strong>Partial results.</strong> {degradedKinds.join(', ')} could not be loaded.
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      <SectionCard
        title="Queue"
        description={`${visible.length} matching item${visible.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Queue state"
              value={state}
              onChange={(event) => setState(event.target.value as AttentionState)}
            >
              <option value="open">Open</option>
              <option value="acknowledged">History</option>
              <option value="all">All</option>
            </select>
            <select
              aria-label="Severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as typeof severity)}
            >
              <option value="all">All severities</option>
              <option value="action_required">Action required</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
            </select>
            <select
              aria-label="Kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="all">All kinds</option>
              <option value="lesson_proposal">Lessons</option>
              <option value="review_failure">Review failures</option>
              <option value="trigger_failure">Trigger failures</option>
              <option value="agent_loop_break">Loop breaks</option>
              <option value="queue_interrupted">Paused queues</option>
            </select>
          </div>
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            title={state === 'open' ? 'Nothing needs attention' : 'No matching history'}
            description="Items come from learning reviews, triggers, follow-up queues and loop breaks."
          />
        ) : (
          <ItemList>
            {visible.map((item) => (
              <ItemRow
                key={item.key}
                title={item.title}
                meta={
                  <>
                    <StatusBadge variant={SEVERITY_BADGE[item.severity]}>
                      {item.severity.replace('_', ' ')}
                    </StatusBadge>
                    <span>{item.kind.replaceAll('_', ' ')}</span>
                    <span>
                      {[item.agentName, item.teamName].filter(Boolean).join(' · ') || 'System'}
                    </span>
                    <time dateTime={new Date(item.occurredAt).toISOString()}>
                      {new Date(item.occurredAt).toLocaleString()}
                    </time>
                  </>
                }
                actions={
                  <>
                    <Link to={item.href} className="btn-primary">
                      {item.kind === 'lesson_proposal' ? 'Review lesson' : 'Inspect source'}
                    </Link>
                    {item.acknowledgeable && (
                      <Button
                        variant="ghost"
                        disabled={busy === item.key}
                        onClick={() => void acknowledge(item, item.acknowledgedAt === null)}
                      >
                        {item.acknowledgedAt === null ? 'Acknowledge' : 'Restore to open'}
                      </Button>
                    )}
                  </>
                }
              >
                <p className="mb-0 mt-1 text-sm text-muted-foreground">{item.diagnostic}</p>
              </ItemRow>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </PageShell>
  )
}
