// Schedules in words: "Weekdays at 09:00", not `0 9 * * 1-5`. The daemon stores a schedule as an
// interval in seconds or a five-field cron expression on its own clock; the Schedules sheet offers
// the common ones as presets and keeps cron for the rest.

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

/** What the schedule says, and whether that is a cron expression shown as it is. */
export function describeSchedule(trigger: {
  kind: AgentTrigger['kind']
  intervalSec?: number | null
  cronExpr?: string | null
}): { text: string; raw: boolean } {
  if (trigger.kind === 'interval')
    return { text: describeInterval(trigger.intervalSec ?? 0), raw: false }
  const expression = trigger.cronExpr ?? ''
  const words = describeCron(expression)
  return words ? { text: words, raw: false } : { text: expression, raw: true }
}

export type Repeat = 'minutes' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'

export const REPEATS: readonly { value: Repeat; label: string }[] = [
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
  message: string
}

export const EMPTY_SCHEDULE: ScheduleDraft = {
  repeat: 'weekdays',
  minutes: '30',
  time: '09:00',
  day: '1',
  cron: '',
  message: '',
}

/** The draft's field a problem belongs under. */
export type ScheduleField = 'minutes' | 'time' | 'cron' | 'message'

/** The request for a draft, or what is wrong with it and in which field. */
export function scheduleRequest(
  draft: ScheduleDraft,
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
