import type {
  AttentionItem,
  AttentionKind,
  AttentionListResponse,
  AttentionState,
  AttentionSummary,
} from '@bazilion/api-types'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { BellRing } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'
import { PageHeader, PageShell } from '../../components/Page'
import { Segmented } from '../../components/Segmented'
import { FilterSelect } from '../../components/ui/form'
import {
  Banner,
  CardBody,
  CardEmpty,
  CardList,
  CardToolbar,
  Chip,
  ListRow,
  Notice,
  SetupCard,
} from '../../components/ui/parts'
import { api, errorMessage } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'
import { ATTENTION_KINDS, attentionSource, attentionSummary, severityLabel } from '../../lib/manage'
import { ago } from '../../lib/model-facts'

const LIST_PATH = '/api/attention?state=all&limit=200'
const SUMMARY_PATH = '/api/attention/summary'

const loadAttention = createServerFn({ method: 'GET' }).handler(async () => {
  const client = daemonClient()
  const [list, summary] = await Promise.all([
    client.get<AttentionListResponse>(LIST_PATH),
    client.get<AttentionSummary>(SUMMARY_PATH),
  ])
  // "2 hours ago" is counted from one clock, on the server and in the browser.
  return { list, summary, now: Date.now() }
})

export const Route = createFileRoute('/attention/')({
  loader: () => loadAttention(),
  component: AttentionCenter,
})

type Severity = 'all' | AttentionItem['severity']

function AttentionCenter() {
  const initial = Route.useLoaderData()
  const [list, setList] = useState(initial.list)
  const [summary, setSummary] = useState(initial.summary)
  const [now, setNow] = useState(initial.now)
  const [state, setState] = useState<AttentionState>('open')
  const [kind, setKind] = useState<AttentionKind | 'all'>('all')
  const [severity, setSeverity] = useState<Severity>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null)
  const visible = list.items.filter(
    (item) =>
      (state === 'all' ||
        (state === 'open' ? item.acknowledgedAt === null : item.acknowledgedAt !== null)) &&
      (kind === 'all' || item.kind === kind) &&
      (severity === 'all' || item.severity === severity),
  )
  const openCount = list.items.filter((item) => item.acknowledgedAt === null).length
  const acknowledgeable = list.items.filter(
    (item) => item.acknowledgeable && item.acknowledgedAt === null,
  ).length
  const degraded = [...new Set([...list.degraded, ...summary.degraded].map((entry) => entry.kind))]
  const line = attentionSummary(summary)

  async function refresh() {
    const [nextList, nextSummary] = await Promise.all([
      api<AttentionListResponse>(LIST_PATH),
      api<AttentionSummary>(SUMMARY_PATH),
    ])
    setList(nextList)
    setSummary(nextSummary)
    setNow(Date.now())
  }

  async function run(key: string, request: () => Promise<string | null>) {
    setBusy(key)
    setNotice(null)
    try {
      const text = await request()
      if (text) setNotice({ text, failed: false })
    } catch (cause) {
      setNotice({ text: errorMessage(cause), failed: true })
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
      return `Acknowledged ${acknowledged === 1 ? '1 item' : `${acknowledged} items`}. Lesson proposals and paused queues stay open until they are dealt with.`
    })

  return (
    <PageShell>
      <PageHeader
        title="Attention"
        description="Decisions waiting for you and failures worth a look, from every Agent. Act on an item where it comes from; acknowledge the ones that only inform."
      />
      <Banner tone={line.tone} lead={line.lead}>
        {line.rest}
      </Banner>
      {degraded.length > 0 && (
        <Banner tone="warning" role="alert" lead="Some items could not be loaded.">
          {degraded.map((entry) => ATTENTION_KINDS[entry]).join(', ')} are missing from the list.
        </Banner>
      )}
      <SetupCard
        labelledBy="attention-items"
        icon={<BellRing className="size-5" />}
        title="Items"
        description="Open items need you; history keeps the ones you acknowledged."
        action={
          acknowledgeable > 0 && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void acknowledgeAll()}>
              Acknowledge {acknowledgeable === 1 ? 'the informational one' : 'informational ones'}
            </Button>
          )
        }
      >
        <CardToolbar>
          <Segmented
            label="Which items"
            value={state}
            onChange={setState}
            options={[
              { id: 'open', label: `Open ${openCount}` },
              { id: 'acknowledged', label: 'History' },
              { id: 'all', label: 'All' },
            ]}
          />
          <FilterSelect
            label="Kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All kinds' },
              ...(Object.entries(ATTENTION_KINDS) as [AttentionKind, string][]).map(
                ([value, label]) => ({ value, label }),
              ),
            ]}
          />
          <FilterSelect
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: 'all', label: 'Any severity' },
              { value: 'action_required', label: 'Needs you' },
              { value: 'error', label: 'Errors' },
              { value: 'warning', label: 'Warnings' },
            ]}
          />
        </CardToolbar>
        {notice && (
          <CardBody className="py-3">
            <Notice
              tone={notice.failed ? 'warning' : 'success'}
              role={notice.failed ? 'alert' : 'status'}
            >
              {notice.text}
            </Notice>
          </CardBody>
        )}
        {visible.length === 0 ? (
          <CardEmpty
            icon={<BellRing className="size-5" />}
            title={
              state === 'open' && kind === 'all' && severity === 'all'
                ? 'Nothing needs you'
                : 'No item matches'
            }
          >
            Items come from learning reviews, schedules, follow-up queues and message loops.
          </CardEmpty>
        ) : (
          <CardList>
            {visible.map((item) => {
              const label = severityLabel(item.severity)
              const acknowledged = item.acknowledgedAt !== null
              return (
                <ListRow
                  key={item.key}
                  title={item.title}
                  chip={
                    acknowledged ? (
                      <Chip tone="neutral">Acknowledged</Chip>
                    ) : (
                      <Chip tone={label.tone}>{label.label}</Chip>
                    )
                  }
                  meta={
                    <>
                      <span>{ATTENTION_KINDS[item.kind]}</span>
                      <span>{attentionSource(item)}</span>
                      <time
                        dateTime={new Date(item.occurredAt).toISOString()}
                        title={new Date(item.occurredAt)
                          .toISOString()
                          .slice(0, 16)
                          .replace('T', ' ')}
                      >
                        {ago(item.occurredAt, now)}
                      </time>
                    </>
                  }
                  actions={
                    <>
                      <Link to={item.href} className="ghost-btn no-underline">
                        {item.kind === 'lesson_proposal' ? 'Review lesson' : 'Open'}
                      </Link>
                      {item.acknowledgeable && (
                        <Button
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => void acknowledge(item, !acknowledged)}
                        >
                          {acknowledged ? 'Back to open' : 'Acknowledge'}
                        </Button>
                      )}
                    </>
                  }
                >
                  <p className="m-0 text-sm text-muted-foreground">{item.diagnostic}</p>
                </ListRow>
              )
            })}
          </CardList>
        )}
      </SetupCard>
    </PageShell>
  )
}
