import { afterEach, describe, expect, test } from 'vitest'
import { matchesCron, parseCron, validateCron } from '../src/lib/cron.ts'

function at(y: number, mo: number, d: number, h: number, mi: number, dow?: number): Date {
  // Local time — matches what matchesCron reads via getMinutes / getHours / etc.
  // dow is ignored; JS computes it from the date itself.
  void dow
  return new Date(y, mo - 1, d, h, mi, 0, 0)
}

describe('parseCron syntax', () => {
  test('star-only', () => {
    expect(() => parseCron('* * * * *')).not.toThrow()
  })
  test('step', () => {
    const p = parseCron('*/15 * * * *')
    expect(p.minute.has(0)).toBe(true)
    expect(p.minute.has(15)).toBe(true)
    expect(p.minute.has(30)).toBe(true)
    expect(p.minute.has(45)).toBe(true)
    expect(p.minute.has(10)).toBe(false)
  })
  test('list', () => {
    const p = parseCron('0,30 * * * *')
    expect(p.minute.has(0)).toBe(true)
    expect(p.minute.has(30)).toBe(true)
    expect(p.minute.has(15)).toBe(false)
  })
  test('range', () => {
    const p = parseCron('10-15 * * * *')
    expect(p.minute.has(10)).toBe(true)
    expect(p.minute.has(15)).toBe(true)
    expect(p.minute.has(16)).toBe(false)
  })
  test('range with step', () => {
    const p = parseCron('0-30/10 * * * *')
    expect(p.minute.has(0)).toBe(true)
    expect(p.minute.has(10)).toBe(true)
    expect(p.minute.has(20)).toBe(true)
    expect(p.minute.has(30)).toBe(true)
    expect(p.minute.has(40)).toBe(false)
  })
  test('Sunday normalization (7 → 0)', () => {
    const p = parseCron('0 0 * * 7')
    expect(p.dow.has(0)).toBe(true)
  })
  test('rejects 4 fields', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/)
  })
  test('rejects out-of-range minute', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/out of range/)
  })
  test('rejects garbage', () => {
    expect(() => parseCron('foo * * * *')).toThrow()
  })
  test('validateCron throws on bad input', () => {
    expect(() => validateCron('* * * *')).toThrow()
  })
})

describe('matchesCron semantics', () => {
  test('every minute matches any minute', () => {
    const p = parseCron('* * * * *')
    expect(matchesCron(p, at(2026, 4, 17, 14, 37))).toBe(true)
  })
  test('every 5 minutes matches minute 25', () => {
    const p = parseCron('*/5 * * * *')
    expect(matchesCron(p, at(2026, 4, 17, 14, 25))).toBe(true)
    expect(matchesCron(p, at(2026, 4, 17, 14, 26))).toBe(false)
  })
  test('hour-restricted fires only in that hour', () => {
    const p = parseCron('0 9 * * *')
    expect(matchesCron(p, at(2026, 4, 17, 9, 0))).toBe(true)
    expect(matchesCron(p, at(2026, 4, 17, 9, 1))).toBe(false)
    expect(matchesCron(p, at(2026, 4, 17, 10, 0))).toBe(false)
  })
  test('dow-only fires on that weekday', () => {
    // 2026-04-17 is a Friday (dow=5).
    const p = parseCron('0 0 * * 5')
    expect(matchesCron(p, at(2026, 4, 17, 0, 0))).toBe(true)
    expect(matchesCron(p, at(2026, 4, 18, 0, 0))).toBe(false)
  })
  test('dom+dow restricted => OR semantics (standard cron)', () => {
    // Every Friday OR the 15th. 2026-04-17 = Friday, 2026-04-15 = 15th (Wed).
    const p = parseCron('0 0 15 * 5')
    expect(matchesCron(p, at(2026, 4, 17, 0, 0))).toBe(true) // Fri
    expect(matchesCron(p, at(2026, 4, 15, 0, 0))).toBe(true) // 15th
    expect(matchesCron(p, at(2026, 4, 16, 0, 0))).toBe(false)
  })
})

describe('matchesCron across daylight-saving changes (daemon local time)', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  /** Instants (ISO) among `count` minutes from `start` that the expression matches in `tz`. */
  function matching(tz: string, expression: string, start: string, count: number): string[] {
    process.env.TZ = tz
    const cron = parseCron(expression)
    return Array.from({ length: count }, (_, i) => new Date(Date.parse(start) + i * 60_000))
      .filter((date) => matchesCron(cron, date))
      .map((date) => date.toISOString())
  }

  test.each([
    ['America/New_York', '2026-03-07T07:30:00Z', '2026-03-08T06:00:00Z', '2026-03-09T06:30:00Z'],
    ['Europe/Berlin', '2026-03-28T01:30:00Z', '2026-03-29T00:00:00Z', '2026-03-30T00:30:00Z'],
  ])('02:30 in %s matches around the spring-forward gap but not on the skipped day', (tz, dayBefore, gapStart, dayAfter) => {
    expect(matching(tz, '30 2 * * *', dayBefore, 1)).toEqual([new Date(dayBefore).toISOString()])
    expect(matching(tz, '30 2 * * *', gapStart, 180)).toEqual([])
    expect(matching(tz, '30 2 * * *', dayAfter, 1)).toEqual([new Date(dayAfter).toISOString()])
  })

  test.each([
    [
      'America/New_York',
      '30 1 * * *',
      '2026-11-01T04:00:00Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ],
    [
      'Europe/Berlin',
      '30 2 * * *',
      '2026-10-24T23:00:00Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ],
  ])('a time in the repeated fall-back hour in %s matches both real instants', (tz, expression, start, first, second) => {
    expect(matching(tz, expression, start, 240)).toEqual([first, second])
  })

  test('expressions follow the daemon local time, not UTC', () => {
    expect(matching('Europe/Berlin', '0 9 * * *', '2026-01-15T07:30:00Z', 120)).toEqual([
      '2026-01-15T08:00:00.000Z',
    ])
    expect(matching('Europe/Berlin', '0 9 * * *', '2026-07-15T06:30:00Z', 120)).toEqual([
      '2026-07-15T07:00:00.000Z',
    ])
  })
})
