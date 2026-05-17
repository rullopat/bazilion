import { describe, expect, test } from 'vitest'
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
