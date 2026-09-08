import type { NotificationQuietHours } from '@bazilion/api-types'

function minutes(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Quiet hours require HH:mm in the 24-hour clock')
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}

export function notificationTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100 || !value.trim() || /^[+-]/.test(value))
    throw new Error('An IANA timezone is required')
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    throw new Error('An IANA timezone is required')
  }
}

export function notificationQuietHours(value: unknown): NotificationQuietHours | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Quiet hours must be null or {start, end}')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'start' && key !== 'end'))
    throw new Error('Unknown quiet-hours field')
  if (minutes(record.start) === minutes(record.end))
    throw new Error('Quiet hours start and end must differ')
  return { start: record.start as string, end: record.end as string }
}

/** Evaluate actual instants rather than synthesizing ambiguous/nonexistent DST wall times. */
export function isNotificationQuiet(
  now: number,
  timezone: string,
  quiet: NotificationQuietHours | null,
): boolean {
  if (!Number.isFinite(now)) throw new Error('Invalid notification time')
  if (!quiet) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const current = hour * 60 + minute
  const start = minutes(quiet.start)
  const end = minutes(quiet.end)
  return start < end ? current >= start && current < end : current >= start || current < end
}
