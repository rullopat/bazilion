import type { WebToken } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { tokenForm, tokenState, when } from '../src/lib/token-form.ts'

test('a token needs a label; the days are optional and whole', () => {
  expect(tokenForm({ label: '', days: '' })).toEqual({ problems: {}, missing: null, body: null })
  expect(tokenForm({ label: ' laptop ', days: '' })).toEqual({
    problems: {},
    missing: null,
    body: { label: 'laptop' },
  })
  expect(tokenForm({ label: 'laptop', days: ' 30 ' }).body).toEqual({
    label: 'laptop',
    expiresInDays: 30,
  })
  // Days without a label: say what is missing rather than only keeping Create off.
  expect(tokenForm({ label: '', days: '30' })).toEqual({
    problems: {},
    missing: 'A token needs a label to tell it from the others.',
    body: null,
  })
  for (const days of ['0', '-1', '1.5', 'a week', '1e3']) {
    expect(tokenForm({ label: 'laptop', days })).toEqual({
      problems: { days: 'A whole number of days, 1 or more. Empty means it never expires.' },
      missing: null,
      body: null,
    })
  }
})

test('a token is active until it is revoked or its time is up', () => {
  const now = Date.UTC(2026, 10, 22, 12, 0)
  const token = (more: Partial<WebToken>): WebToken => ({
    id: 't',
    label: 'laptop',
    kind: 'device',
    createdAt: now - 1000,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...more,
  })
  expect(tokenState(token({}), now)).toEqual({ label: 'Active', tone: 'success' })
  expect(tokenState(token({ expiresAt: now + 1 }), now).label).toBe('Active')
  expect(tokenState(token({ expiresAt: now }), now)).toEqual({ label: 'Expired', tone: 'neutral' })
  expect(tokenState(token({ revokedAt: now - 5 }), now)).toEqual({
    label: 'Revoked',
    tone: 'neutral',
  })
  // Revoked says more than expired.
  expect(tokenState(token({ revokedAt: now - 5, expiresAt: now - 10 }), now).label).toBe('Revoked')
})

test('a moment is written to the minute, the same on the server and in the browser', () => {
  expect(when(Date.UTC(2026, 10, 21, 23, 13, 59))).toBe('2026-11-21 23:13')
})
