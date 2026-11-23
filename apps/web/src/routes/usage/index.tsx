import {
  formatCost,
  formatTokens,
  type UsageReport,
  type UsageTotals,
  usageSummary,
} from '@bazilion/api-types'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { BarChart3, Bot, Cpu, UsersRound } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { ManagePage } from '../../components/ManagePage'
import { Segmented } from '../../components/Segmented'
import {
  Banner,
  CardBody,
  CardEmpty,
  CardList,
  Chip,
  ListRow,
  Notice,
  SetupCard,
} from '../../components/ui/parts'
import {
  DayChart,
  type DayMetric,
  dayLabel,
  dayValue,
  formatMetric,
} from '../../components/usage/DayChart'
import { api } from '../../lib/api'

const PERIODS = [
  { id: '1', label: 'Today' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'Everything' },
] as const
type Period = (typeof PERIODS)[number]['id']

interface UsageSearch {
  /** Days counted (a number in the address: `?days=7`), or `all`. */
  days?: 1 | 7 | 30 | 90 | 'all'
  agent?: string
  team?: string
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** The address's period: `?days=7` reads as the number 7, `?days=all` as text. */
function parseDays(value: unknown): UsageSearch['days'] {
  const period = PERIODS.find((entry) => entry.id === String(value))?.id
  if (!period) return undefined
  return period === 'all' ? 'all' : (Number(period) as 1 | 7 | 30 | 90)
}

export const Route = createFileRoute('/usage/')({
  validateSearch: (search: Record<string, unknown>): UsageSearch => ({
    days: parseDays(search.days),
    agent: text(search.agent),
    team: text(search.team),
  }),
  component: UsagePage,
})

/** The report, asked for in this browser's time zone (the server does not know it). */
function useUsage(search: UsageSearch) {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const days = String(search.days ?? 30)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      days,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    })
    if (search.agent) query.set('agent', search.agent)
    if (search.team) query.set('team', search.team)
    setError(null)
    api<UsageReport>(`/api/usage?${query}`, { signal: controller.signal })
      .then(setReport)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => controller.abort()
  }, [days, search.agent, search.team])
  return { report, error }
}

function UsagePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/usage/' })
  const { report, error } = useUsage(search)
  const period = String(search.days ?? 30) as Period

  return (
    <ManagePage
      title="Usage"
      description="What your Agents' model calls used, read from the saved conversations: the money spent on providers paid per use, and the tokens of subscriptions and of models on this computer."
      actions={
        <Segmented
          label="Period"
          value={period}
          options={PERIODS}
          onChange={(days) =>
            void navigate({ search: (prev) => ({ ...prev, days: parseDays(days) }) })
          }
        />
      }
    >
      {report?.scope && (
        <Banner
          tone="neutral"
          lead={`Only ${report.scope.name}`}
          action={
            <Button
              variant="ghost"
              onClick={() => void navigate({ search: (prev) => ({ days: prev.days }) })}
            >
              Show every Agent
            </Button>
          }
        >
          {report.scope.kind === 'agent' ? 'One Agent' : 'The Agents of one Team'}, as Usage counts
          them below.
        </Banner>
      )}
      {error && (
        <Notice tone="danger" title="Usage could not be read">
          {error}
        </Notice>
      )}
      {!report && !error && <p className="text-sm text-muted-foreground">Counting…</p>}
      {report && <UsageBody report={report} period={period} />}
    </ManagePage>
  )
}

function UsageBody({ report, period }: { report: UsageReport; period: Period }) {
  const { totals } = report
  const [chosen, setMetric] = useState<DayMetric | null>(null)
  const metric: DayMetric = chosen ?? (totals.cost > 0 ? 'cost' : 'tokens')
  const showDays = report.days !== null && report.days > 1
  return (
    <>
      <Totals report={report} />
      {report.unreadable > 0 && (
        <Notice tone="warning" title="Some conversations are not counted">
          {report.unreadable} saved conversation{report.unreadable === 1 ? '' : 's'} could not be
          read.
        </Notice>
      )}
      {totals.calls === 0 ? (
        <SetupCard
          labelledBy="usage-empty"
          icon={<BarChart3 className="size-5" />}
          title="By day"
          description={periodWords(report)}
        >
          <CardEmpty icon={<BarChart3 className="size-5" />} title="No model calls in this period">
            {period === 'all'
              ? 'Nothing is counted until an Agent answers in a conversation.'
              : 'Pick a longer period to see earlier use.'}
          </CardEmpty>
        </SetupCard>
      ) : (
        <>
          {showDays && (
            <SetupCard
              labelledBy="usage-days"
              icon={<BarChart3 className="size-5" />}
              title="By day"
              description={periodWords(report)}
              action={
                <Segmented
                  label="Show"
                  value={metric}
                  options={[
                    { id: 'cost', label: 'Spent' },
                    { id: 'tokens', label: 'Tokens' },
                  ]}
                  onChange={setMetric}
                />
              }
            >
              <CardBody>
                <DayChart days={report.byDay} metric={metric} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    The days as a table
                  </summary>
                  <table className="mt-2 w-full text-left tabular-nums">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">Day</th>
                        <th className="py-1 font-medium">Spent</th>
                        <th className="py-1 font-medium">Tokens</th>
                        <th className="py-1 font-medium">Model calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byDay.toReversed().map((day) => (
                        <tr key={day.day} className="border-t border-border">
                          <td className="py-1">{dayLabel(day.day, { year: 'numeric' })}</td>
                          <td className="py-1">{formatCost(day.cost)}</td>
                          <td className="py-1">{formatTokens(day.totalTokens)}</td>
                          <td className="py-1">{day.calls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                {metric === 'cost' && peakDay(report, metric)}
              </CardBody>
            </SetupCard>
          )}
          <Breakdown
            id="usage-teams"
            icon={<UsersRound className="size-5" />}
            title="By Team"
            description="Each Agent's use counts for the Team it is in now."
            rows={report.byTeam.map((team) => ({
              key: team.teamId,
              title: (
                <Link to="/usage" search={{ days: parseDays(period), team: team.teamId }}>
                  {team.teamName}
                </Link>
              ),
              totals: team,
            }))}
          />
          <Breakdown
            id="usage-agents"
            icon={<Bot className="size-5" />}
            title="By Agent"
            description="Open one for only its use."
            rows={report.byAgent.map((agent) => ({
              key: agent.agentId,
              title: (
                <Link to="/usage" search={{ days: parseDays(period), agent: agent.agentId }}>
                  {agent.agentName}
                </Link>
              ),
              chip: agent.archived ? <Chip tone="neutral">Archived</Chip> : undefined,
              meta: agent.teamName,
              totals: agent,
            }))}
          />
          <Breakdown
            id="usage-models"
            icon={<Cpu className="size-5" />}
            title="By model"
            description="Subscriptions and models on this computer cost nothing per use."
            rows={report.byModel.map((model) => ({
              key: `${model.provider}/${model.model}`,
              title: <span className="break-all">{model.model}</span>,
              chip:
                model.billing === 'plan' ? (
                  <Chip tone="neutral">Subscription</Chip>
                ) : model.billing === 'local' ? (
                  <Chip tone="neutral">This computer</Chip>
                ) : undefined,
              meta: model.providerName,
              totals: model,
            }))}
          />
        </>
      )}
    </>
  )
}

function periodWords(report: UsageReport): string {
  if (report.days === null) return 'Everything in the saved conversations.'
  if (report.days === 1) return `Today, ${dayLabel(report.to)}.`
  return `${report.from ? dayLabel(report.from) : ''} to ${dayLabel(report.to)}, in this browser's time zone.`
}

function peakDay(report: UsageReport, metric: DayMetric): ReactNode {
  const peak = report.byDay.reduce<(typeof report.byDay)[number] | null>(
    (best, day) => (!best || dayValue(day, metric) > dayValue(best, metric) ? day : best),
    null,
  )
  if (!peak || dayValue(peak, metric) === 0) return null
  return (
    <p className="m-0 text-sm text-muted-foreground">
      The most was spent on {dayLabel(peak.day)}: {formatMetric(dayValue(peak, metric), metric)}.
    </p>
  )
}

function Totals({ report }: { report: UsageReport }) {
  const { totals } = report
  return (
    <section
      aria-labelledby="usage-totals"
      className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-baziu-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)]"
    >
      <div className="min-w-0">
        <h2 id="usage-totals" className="m-0 font-body text-sm font-medium text-muted-foreground">
          Spent
        </h2>
        <p className="m-0 font-body text-5xl font-semibold leading-tight text-foreground">
          {formatCost(totals.cost)}
        </p>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {totals.cost === 0
            ? 'On providers paid per use.'
            : totals.estimated
              ? 'Estimated from catalog prices, except what a provider reported it billed.'
              : 'As the providers reported it billed.'}
          {totals.unpricedTokens > 0 &&
            ` ${formatTokens(totals.unpricedTokens)} tokens on models with no known price are not in it.`}
        </p>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 self-start sm:grid-cols-4">
        <Stat label="Tokens" value={formatTokens(totals.totalTokens)} />
        <Stat label="On a subscription" value={formatTokens(totals.planTokens)} />
        <Stat label="On this computer" value={formatTokens(totals.localTokens)} />
        <Stat label="Model calls" value={totals.calls.toLocaleString()} />
      </dl>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-xl font-semibold text-foreground">{value}</dd>
    </div>
  )
}

function Breakdown({
  id,
  icon,
  title,
  description,
  rows,
}: {
  id: string
  icon: ReactNode
  title: string
  description: string
  rows: Array<{
    key: string
    title: ReactNode
    chip?: ReactNode
    meta?: ReactNode
    totals: UsageTotals
  }>
}) {
  if (rows.length === 0) return null
  return (
    <SetupCard labelledBy={id} icon={icon} title={title} description={description}>
      <CardList>
        {rows.map((row) => (
          <ListRow
            inline
            key={row.key}
            title={row.title}
            chip={row.chip}
            meta={
              <>
                {row.meta && <span>{row.meta}</span>}
                <span>
                  {formatTokens(row.totals.inputTokens + row.totals.cacheReadTokens)} in ·{' '}
                  {formatTokens(row.totals.outputTokens)} out · {row.totals.calls.toLocaleString()}{' '}
                  call
                  {row.totals.calls === 1 ? '' : 's'}
                </span>
              </>
            }
            actions={
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {usageSummary(row.totals)}
              </span>
            }
          />
        ))}
      </CardList>
    </SetupCard>
  )
}
