// One column per day: what was spent, or how many tokens were used. Pointing at a column, or
// moving along them with the arrow keys once the chart has the focus, shows that day's figures;
// the same figures are in the table under the chart.

import { formatCost, formatTokens, type UsageDay } from '@bazilion/api-types'
import { useId, useState } from 'react'

export type DayMetric = 'cost' | 'tokens'

const HEIGHT = 160

/** "Sun 22 Nov": a `YYYY-MM-DD` day in this browser's words. */
export function dayLabel(day: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...options,
  })
}

export const dayValue = (day: UsageDay, metric: DayMetric) =>
  metric === 'cost' ? day.cost : day.totalTokens

export const formatMetric = (value: number, metric: DayMetric) =>
  metric === 'cost' ? formatCost(value) : `${formatTokens(value)} tokens`

export function DayChart({ days, metric }: { days: readonly UsageDay[]; metric: DayMetric }) {
  const [active, setActive] = useState<number | null>(null)
  const describedBy = useId()
  const max = Math.max(...days.map((day) => dayValue(day, metric)), 0)
  const shown = active === null ? null : days[active]
  const total = days.reduce((sum, day) => sum + dayValue(day, metric), 0)
  const peak = days.reduce<UsageDay | null>(
    (best, day) => (!best || dayValue(day, metric) > dayValue(best, metric) ? day : best),
    null,
  )
  const first = days[0]
  const last = days.at(-1)

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">{max > 0 ? formatMetric(max, metric) : ''}</span>
        <span aria-hidden="true" className="font-medium text-foreground">
          {shown ? (
            <>
              <strong className="font-semibold">
                {formatMetric(dayValue(shown, metric), metric)}
              </strong>{' '}
              <span className="text-muted-foreground">{dayLabel(shown.day)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Point at a day, or use the arrow keys</span>
          )}
        </span>
      </div>
      {/* The arrow keys pick the day whose figures are read out: a slider over the days. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${metric === 'cost' ? 'Spent' : 'Tokens'} per day, ${formatMetric(total, metric)} in all${peak && dayValue(peak, metric) > 0 ? `; most on ${dayLabel(peak.day)}, ${formatMetric(dayValue(peak, metric), metric)}` : ''}`}
        aria-describedby={describedBy}
        aria-valuemin={0}
        aria-valuemax={Math.max(days.length - 1, 0)}
        aria-valuenow={active ?? Math.max(days.length - 1, 0)}
        aria-valuetext={(() => {
          const day = days[active ?? days.length - 1]
          return day ? `${dayLabel(day.day)}: ${formatMetric(dayValue(day, metric), metric)}` : ''
        })()}
        onKeyDown={(event) => {
          if (days.length === 0) return
          const at = active ?? days.length - 1
          let next: number | null = null
          if (event.key === 'ArrowLeft') next = Math.max(at - 1, 0)
          else if (event.key === 'ArrowRight') next = Math.min(at + 1, days.length - 1)
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = days.length - 1
          if (next === null) return
          event.preventDefault()
          setActive(next)
        }}
        onFocus={() => setActive((current) => current ?? days.length - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="relative flex items-end gap-0.5 rounded-md border-b border-border outline-offset-4"
        style={{ height: HEIGHT }}
      >
        <span id={describedBy} className="sr-only">
          The table under the chart lists every day.
        </span>
        {days.map((day, index) => {
          const value = dayValue(day, metric)
          const height = max > 0 && value > 0 ? Math.max((value / max) * HEIGHT, 2) : 0
          return (
            <div
              key={day.day}
              onPointerEnter={() => setActive(index)}
              className="flex h-full min-w-0 flex-1 items-end justify-center"
            >
              <div
                className={`w-full max-w-6 rounded-t-[4px] transition-opacity ${
                  active !== null && active !== index ? 'opacity-55' : ''
                } bg-chart-bar`}
                style={{ height }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{first ? dayLabel(first.day) : ''}</span>
        <span>{last && last !== first ? dayLabel(last.day) : ''}</span>
      </div>
    </div>
  )
}
