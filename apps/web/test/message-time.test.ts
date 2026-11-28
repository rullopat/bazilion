// When each message was sent, and the line for each day (BAZ-101).
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dayKey, dayLabel } from '../src/lib/message-time.ts'

beforeEach(() => vi.stubEnv('TZ', 'Europe/Rome'))
afterEach(() => vi.unstubAllEnvs())

const local = (text: string) => new Date(text).getTime()

test('days are named as a messaging app names them', () => {
  const now = local('2026-11-28T10:00:00')
  expect(dayLabel(local('2026-11-28T00:05:00'), now)).toBe('Today')
  expect(dayLabel(local('2026-11-27T23:59:00'), now)).toBe('Yesterday')
  expect(dayLabel(local('2026-11-24T12:00:00'), now)).toBe(
    new Date(local('2026-11-24T12:00:00')).toLocaleDateString(undefined, { weekday: 'long' }),
  )
  const older = dayLabel(local('2026-11-01T12:00:00'), now)
  expect(older).toContain('1')
  expect(older).not.toContain('2026')
  expect(dayLabel(local('2025-12-31T12:00:00'), now)).toContain('2025')
})

test('a day changes at local midnight', () => {
  expect(dayKey(local('2026-11-28T00:00:00'))).toBe(dayKey(local('2026-11-28T23:59:59')))
  expect(dayKey(local('2026-11-27T23:59:59'))).not.toBe(dayKey(local('2026-11-28T00:00:00')))
})

test('a daylight-saving change does not shift yesterday', () => {
  // 2026-10-25 has 25 hours in Rome.
  expect(dayLabel(local('2026-10-25T12:00:00'), local('2026-10-26T09:00:00'))).toBe('Yesterday')
})
