// When a message was sent, as a messaging app says it (BAZ-101): its time under it, and a line
// before the first message of each day. In the browser's language and time zone.

const DAY_MS = 24 * 60 * 60 * 1000

/** "14:32", or "02:32 PM", as the browser's language writes a time. */
export function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** The whole date and time, for pointing at a message's time. */
export function fullTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

/** The local calendar day of a time, as a key that changes exactly at local midnight. */
export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Local midnight of the day `at` falls on. */
function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * The line before a day's first message: Today, Yesterday, the weekday within the last week, then
 * the date, with the year when it is not this year's.
 */
export function dayLabel(at: number, now: number = Date.now()): string {
  // Whole days between the two local midnights; rounding absorbs a daylight-saving hour.
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const date = new Date(at)
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
