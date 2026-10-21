import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'

/** Real production matcher in a fresh process with an explicit TZ, never a machine-wide change.
 * This establishes calendar matching, not scheduler claims, dispatches or exactly-once side effects.
 */
function observe(tz: string, expression: string, instants: string[]) {
  const module = new URL('../src/lib/cron.ts', import.meta.url).href
  const program = `
    import { matchesCron, parseCron } from ${JSON.stringify(module)}
    const cron = parseCron(${JSON.stringify(expression)})
    const rows = ${JSON.stringify(instants)}.map(instant => {
      const date = new Date(instant)
      return { instant, matches: matchesCron(cron, date), hour: date.getHours(),
        minute: date.getMinutes(), offsetMinutes: date.getTimezoneOffset() }
    })
    process.stdout.write(JSON.stringify(rows))
  `
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx/esm'), '--input-type=module', '-e', program],
      {
        env: { PATH: process.env.PATH, TZ: tz },
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 128 * 1024,
      },
    ),
  ) as Array<{
    instant: string
    matches: boolean
    hour: number
    minute: number
    offsetMinutes: number
  }>
}
function minutes(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(start) + i * 60_000).toISOString(),
  )
}

test.each([
  {
    zone: 'America/New_York',
    start: '2026-03-08T06:00:00Z',
    before: '2026-03-07T07:30:00Z',
    after: '2026-03-09T06:30:00Z',
    offsets: [300, 240],
  },
  {
    zone: 'Europe/Berlin',
    start: '2026-03-29T00:00:00Z',
    before: '2026-03-28T01:30:00Z',
    after: '2026-03-30T00:30:00Z',
    offsets: [-60, -120],
  },
])('cron skips nonexistent 02:30 during spring gap in $zone without inventing a catch-up', ({
  zone,
  start,
  before,
  after,
  offsets,
}) => {
  const window = observe(zone, '30 2 * * *', minutes(start, 180))
  expect(window.filter((row) => row.matches)).toEqual([])
  expect([...new Set(window.map((row) => row.offsetMinutes))]).toEqual(offsets)
  expect(observe(zone, '30 2 * * *', [before, after]).map((row) => row.matches)).toEqual([
    true,
    true,
  ])
})

test.each([
  {
    zone: 'America/New_York',
    cron: '30 1 * * *',
    start: '2026-11-01T04:00:00Z',
    matches: ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'],
    offsets: [240, 300],
  },
  {
    zone: 'Europe/Berlin',
    cron: '30 2 * * *',
    start: '2026-10-24T23:00:00Z',
    matches: ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'],
    offsets: [-120, -60],
  },
])('cron matches both real instants in repeated hour in $zone', ({
  zone,
  cron,
  start,
  matches,
  offsets,
}) => {
  const matched = observe(zone, cron, minutes(start, 240)).filter((row) => row.matches)
  expect(matched.map((row) => row.instant)).toEqual(matches)
  expect(matched.map((row) => row.offsetMinutes)).toEqual(offsets)
  expect(Date.parse(matched[1]?.instant ?? '') - Date.parse(matched[0]?.instant ?? '')).toBe(
    3_600_000,
  )
})

test('daemon-local cron does not translate requested zone or assume one fixed UTC offset', () => {
  const instants = [
    '2026-01-15T08:00:00Z',
    '2026-01-15T09:00:00Z',
    '2026-07-15T07:00:00Z',
    '2026-07-15T09:00:00Z',
  ]
  expect(observe('Europe/Berlin', '0 9 * * *', instants).map((row) => row.matches)).toEqual([
    true,
    false,
    true,
    false,
  ])
  expect(observe('UTC', '0 9 * * *', instants).map((row) => row.matches)).toEqual([
    false,
    true,
    false,
    true,
  ])
})

test('timezone fixture leaves parent process TZ and clock controls untouched', () => {
  const before = process.env.TZ
  observe('America/New_York', '* * * * *', ['2026-03-08T07:00:00Z'])
  expect(process.env.TZ).toBe(before)
})
