// When a schedule runs, checked the same way for the Schedules sheet, `bazilion trigger` and the
// Agent's `schedule_add`.

import type { AgentTrigger, TriggerKind, TriggerTiming } from '@bazilion/api-types'
import { DomainError } from '../core/errors.ts'
import { onceDone } from '../core/repos/triggers.ts'
import { nextCronMatch, type ParsedCron, parseCron, validateCron } from './cron.ts'

export interface TimingFields {
  kind?: TriggerKind | string
  intervalSec?: unknown
  cronExpr?: unknown
  runAt?: unknown
}

/** The timing the fields describe; a DomainError (400) says what is wrong. */
export function triggerTiming(fields: TimingFields, now = Date.now()): TriggerTiming {
  switch (fields.kind) {
    case 'interval': {
      const intervalSec = fields.intervalSec
      if (typeof intervalSec !== 'number' || !Number.isInteger(intervalSec) || intervalSec < 1)
        throw new DomainError(400, 'intervalSec must be a whole number of seconds, at least 1')
      return { kind: 'interval', intervalSec }
    }
    case 'cron': {
      if (typeof fields.cronExpr !== 'string' || !fields.cronExpr.trim())
        throw new DomainError(400, 'cronExpr is required for kind=cron')
      const cronExpr = fields.cronExpr.trim().replace(/\s+/g, ' ')
      try {
        validateCron(cronExpr)
      } catch (err) {
        throw new DomainError(400, `invalid cron: ${(err as Error).message}`)
      }
      return { kind: 'cron', cronExpr }
    }
    case 'once': {
      const runAt = fields.runAt
      if (typeof runAt !== 'number' || !Number.isFinite(runAt))
        throw new DomainError(400, 'runAt (ms since the epoch) is required for kind=once')
      if (runAt <= now) throw new DomainError(400, 'runAt is in the past')
      return { kind: 'once', runAt: Math.round(runAt) }
    }
    default:
      throw new DomainError(400, `invalid kind: ${String(fields.kind)}`)
  }
}

export function floorToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

/**
 * When a trigger next runs: the next matching minute (a cron), the end of the interval or its
 * time (once), now when that is already past; null when it is paused, a one-time schedule that
 * has run, or an expression that never matches. A busy Agent runs it once its turn ends.
 */
export function nextRunAt(t: AgentTrigger, now = Date.now()): number | null {
  if (!t.enabled) return null
  if (t.kind === 'once') return t.runAt === null || onceDone(t) ? null : Math.max(t.runAt, now)
  if (t.kind === 'interval') {
    const every = (t.intervalSec ?? 0) * 1000
    if (every <= 0) return null
    return Math.max((t.lastFiredAt ?? t.createdAt) + every, now)
  }
  if (!t.cronExpr) return null
  let parsed: ParsedCron
  try {
    parsed = parseCron(t.cronExpr)
  } catch {
    return null
  }
  // A minute it already ran in does not count again.
  const from =
    t.lastFiredAt && floorToMinute(t.lastFiredAt) === floorToMinute(now)
      ? floorToMinute(now) + 60_000
      : floorToMinute(now)
  return nextCronMatch(parsed, from)
}
