// Per-agent budget for verbose mirror lines: 30 per rolling minute.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  _resetLoopGuardForTest,
  allowTelegramOutboundNoise,
} from '../../src/lib/telegram/loop-guard.ts'

beforeEach(() => _resetLoopGuardForTest())
afterEach(() => {
  _resetLoopGuardForTest()
  vi.useRealTimers()
})

describe('allowTelegramOutboundNoise', () => {
  test('allows up to the default noise budget (30), rejects the 31st', () => {
    for (let i = 0; i < 30; i++) {
      expect(allowTelegramOutboundNoise('a')).toBe(true)
    }
    expect(allowTelegramOutboundNoise('a')).toBe(false)
  })

  test('budgets are independent per agent', () => {
    for (let i = 0; i < 30; i++) allowTelegramOutboundNoise('a')
    expect(allowTelegramOutboundNoise('a')).toBe(false)
    expect(allowTelegramOutboundNoise('b')).toBe(true)
  })

  test('recovers as the rolling window drains', () => {
    vi.useFakeTimers()
    const start = Date.now()
    vi.setSystemTime(start)
    for (let i = 0; i < 30; i++) allowTelegramOutboundNoise('a')
    expect(allowTelegramOutboundNoise('a')).toBe(false)

    // 61s later the window has drained; budget is back without any cooldown.
    vi.setSystemTime(start + 61_000)
    expect(allowTelegramOutboundNoise('a')).toBe(true)
  })
})
