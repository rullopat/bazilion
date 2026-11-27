// Schedules in words: "Weekdays at 09:00", not `0 9 * * 1-5`. The daemon stores a schedule as an
// interval in seconds, a five-field cron expression on its own clock, or one time; the Schedules
// sheet offers the common ones as presets and keeps cron for the rest.

import type { AgentTrigger, CreateTriggerRequest } from '@bazilion/api-types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** "Every 5 minutes", "Every 2 hours", "Every 90 seconds". */
export function describeInterval(seconds: number): string {
  if (seconds % 86_400 === 0)
    return seconds === 86_400 ? 'Every day' : `Every ${plural(seconds / 86_400, 'day')}`
  if (seconds % 3_600 === 0)
    return seconds === 3_600 ? 'Every hour' : `Every ${plural(seconds / 3_600, 'hour')}`
  if (seconds % 60 === 0)
    return seconds === 60 ? 'Every minute' : `Every ${plural(seconds / 60, 'minute')}`
  return `Every ${plural(seconds, 'second')}`
}

const number = (field: string): number | null => (/^\d+$/.test(field) ? Number(field) : null)
const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** A cron expression in words when it is one of the common shapes; null otherwise. */
export function describeCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = fields
  if (dayOfMonth !== '*' || month !== '*') return null
  const step = /^\*\/(\d+)$/.exec(minute)
  if (step && hour === '*' && dayOfWeek === '*') return describeInterval(Number(step[1]) * 60)
  if (minute === '*' && hour === '*' && dayOfWeek === '*') return 'Every minute'
  const m = number(minute)
  if (m === null || m > 59) return null
  if (hour === '*' && dayOfWeek === '*')
    return m === 0 ? 'Every hour' : `Every hour at :${clock(0, m).slice(3)}`
  const h = number(hour)
  if (h === null || h > 23) return null
  const at = clock(h, m)
  if (dayOfWeek === '*') return `Every day at ${at}`
  if (dayOfWeek === '1-5') return `Weekdays at ${at}`
  if (dayOfWeek === '0,6' || dayOfWeek === '6,0') return `Weekends at ${at}`
  const day = number(dayOfWeek)
  if (day !== null && day <= 7) return `Every ${DAYS[day % 7]} at ${at}`
  return null
}

/** "Fri 28 Nov, 09:00", with the year when it is not this one; on the reader's clock. */
export function onceWords(at: number, now = Date.now()): string {
  const date = new Date(at)
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * What the schedule says, and whether that is a cron expression shown as it is. A one-time
 * schedule's time is written by `clock`, which only the browser has (its locale and zone).
 */
export function describeSchedule(
  trigger: {
    kind: AgentTrigger['kind']
    intervalSec?: number | null
    cronExpr?: string | null
    runAt?: number | null
  },
  clock?: (at: number) => string,
): { text: string; raw: boolean } {
  if (trigger.kind === 'once') {
    const at = trigger.runAt
    return { text: clock && typeof at === 'number' ? `Once, ${clock(at)}` : 'Once', raw: false }
  }
  if (trigger.kind === 'interval')
    return { text: describeInterval(trigger.intervalSec ?? 0), raw: false }
  const expression = trigger.cronExpr ?? ''
  const words = describeCron(expression)
  return words ? { text: words, raw: false } : { text: expression, raw: true }
}

export type Repeat = 'once' | 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'

export const REPEATS: readonly { value: Repeat; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'minutes', label: 'Every few minutes' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'cron', label: 'A cron expression' },
]

export const WEEKDAYS: readonly { value: string; label: string }[] = [1, 2, 3, 4, 5, 6, 0].map(
  (day) => ({ value: String(day), label: DAYS[day] ?? '' }),
)

export interface ScheduleDraft {
  repeat: Repeat
  /** For "every few minutes". */
  minutes: string
  /** HH:MM, for daily, weekday and weekly schedules. */
  time: string
  /** 0 (Sunday) to 6, for weekly schedules. */
  day: string
  cron: string
  /** For "once": a datetime-local value, YYYY-MM-DDTHH:MM on the reader's clock. */
  at: string
  message: string
}

export const EMPTY_SCHEDULE: ScheduleDraft = {
  repeat: 'weekdays',
  minutes: '30',
  time: '09:00',
  day: '1',
  cron: '',
  at: '',
  message: '',
}

/** The draft's field a problem belongs under. */
export type ScheduleField = 'minutes' | 'time' | 'cron' | 'at' | 'message'

/** The request for a draft, or what is wrong with it and in which field. */
export function scheduleRequest(
  draft: ScheduleDraft,
  now = Date.now(),
):
  | { request: CreateTriggerRequest; problem: null; field: null }
  | { request: null; problem: string; field: ScheduleField } {
  const message = draft.message.trim()
  const fail = (field: ScheduleField, problem: string) =>
    ({ request: null, problem, field }) as const
  const done = (request: Omit<CreateTriggerRequest, 'message'>) =>
    message
      ? ({ request: { ...request, message }, problem: null, field: null } as const)
      : fail('message', 'Write the message the Agent gets.')
  const time = /^(\d{1,2}):(\d{2})$/.exec(draft.time)
  const hour = time ? Number(time[1]) : Number.NaN
  const minute = time ? Number(time[2]) : Number.NaN
  const timeOk = hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
  switch (draft.repeat) {
    case 'once': {
      const runAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft.at)
        ? new Date(draft.at).getTime()
        : Number.NaN
      if (!Number.isFinite(runAt)) return fail('at', 'Give a day and a time.')
      if (runAt <= now) return fail('at', 'Give a time that has not passed yet.')
      return done({ kind: 'once', runAt })
    }
    case 'minutes': {
      const minutes = Number(draft.minutes)
      if (!Number.isInteger(minutes) || minutes < 1)
        return fail('minutes', 'Give a whole number of minutes.')
      return done({ kind: 'interval', intervalSec: minutes * 60 })
    }
    case 'hourly':
      return done({ kind: 'cron', cronExpr: '0 * * * *' })
    case 'daily':
    case 'weekdays':
    case 'weekly': {
      if (!timeOk) return fail('time', 'Give a time of day, such as 09:00.')
      const days = draft.repeat === 'daily' ? '*' : draft.repeat === 'weekdays' ? '1-5' : draft.day
      return done({ kind: 'cron', cronExpr: `${minute} ${hour} * * ${days}` })
    }
    case 'cron': {
      const expression = draft.cron.trim().replace(/\s+/g, ' ')
      if (expression.split(' ').length !== 5)
        return fail('cron', 'A cron expression has five fields: minute, hour, day, month, weekday.')
      return done({ kind: 'cron', cronExpr: expression })
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A time as a datetime-local value, on the reader's clock. */
export function localInput(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The draft that shows a schedule, to change it. A timing the presets cannot show (an interval in
 * seconds) comes back as the nearest one; the sheet sends the timing only when it was changed.
 */
export function draftOf(trigger: AgentTrigger): ScheduleDraft {
  const base = { ...EMPTY_SCHEDULE, message: trigger.message }
  if (trigger.kind === 'once')
    return { ...base, repeat: 'once', at: trigger.runAt ? localInput(trigger.runAt) : '' }
  if (trigger.kind === 'interval')
    return {
      ...base,
      repeat: 'minutes',
      minutes: String(Math.max(1, Math.round((trigger.intervalSec ?? 60) / 60))),
    }
  const expression = (trigger.cronExpr ?? '').trim().replace(/\s+/g, ' ')
  if (expression === '0 * * * *') return { ...base, repeat: 'hourly' }
  const fields = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(expression)
  const minute = Number(fields?.[1])
  const hour = Number(fields?.[2])
  if (fields && minute <= 59 && hour <= 23) {
    const time = `${pad(hour)}:${pad(minute)}`
    const days = fields[3] as string
    if (days === '*') return { ...base, repeat: 'daily', time }
    if (days === '1-5') return { ...base, repeat: 'weekdays', time }
    return { ...base, repeat: 'weekly', time, day: days }
  }
  return { ...base, repeat: 'cron', cron: expression }
}
