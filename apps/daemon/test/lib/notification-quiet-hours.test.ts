import { expect, test } from 'vitest'
import {
  isNotificationQuiet,
  notificationQuietHours,
  notificationTimezone,
} from '../../src/lib/notification-quiet-hours.ts'

test('quiet-hour configuration rejects ambiguous endpoints and invalid zones', () => {
  expect(notificationTimezone('Europe/Warsaw')).toBe('Europe/Warsaw')
  for (const value of ['Mars/Base', '+02:00', '', null])
    expect(() => notificationTimezone(value)).toThrow('IANA')
  for (const value of [
    { start: '24:00', end: '06:00' },
    { start: '22:00', end: '22:00' },
    { start: '9:00', end: '10:00' },
    { start: '22:00', end: '06:00', enabled: true },
  ])
    expect(() => notificationQuietHours(value)).toThrow()
  expect(notificationQuietHours(null)).toBeNull()
})

test('overnight quiet hours include start, exclude end and react to timezone changes', () => {
  const quiet = { start: '22:00', end: '06:00' }
  const at = (time: string, zone = 'UTC') => isNotificationQuiet(Date.parse(time), zone, quiet)
  expect(at('2026-09-07T21:59:00Z')).toBe(false)
  expect(at('2026-09-07T22:00:00Z')).toBe(true)
  expect(at('2026-09-08T05:59:00Z')).toBe(true)
  expect(at('2026-09-08T06:00:00Z')).toBe(false)
  expect(at('2026-09-07T21:00:00Z', 'Europe/Warsaw')).toBe(true)
  expect(at('2026-09-07T21:00:00Z', 'UTC')).toBe(false)
  expect(isNotificationQuiet(Date.now(), 'UTC', null)).toBe(false)
})

test('both repeated DST hours stay quiet and spring gaps do not manufacture local instants', () => {
  const quiet = { start: '01:30', end: '03:00' }
  const at = (time: string) => isNotificationQuiet(Date.parse(time), 'Europe/Warsaw', quiet)
  // Autumn repeats local 02:30 under two offsets.
  expect(at('2026-10-25T00:30:00Z')).toBe(true)
  expect(at('2026-10-25T01:30:00Z')).toBe(true)
  expect(at('2026-10-25T02:00:00Z')).toBe(false)
  // Spring jumps from 01:59 to 03:00, which is the exclusive end.
  expect(at('2026-03-29T00:59:00Z')).toBe(true)
  expect(at('2026-03-29T01:00:00Z')).toBe(false)
})
