// Per-agent sliding-window budget tests. Defaults (env unset): inbound
// 20/60/60, outbound-noise 30/60. Tests assert the boundary + cooldown +
// notify-once behavior without going through routeUpdate (which would spawn
// real worker turns).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  _resetLoopGuardForTest,
  allowTelegramInbound,
  allowTelegramOutboundNoise,
  shouldNotifyInboundThrottle,
} from '../../src/lib/telegram/loop-guard.ts'

beforeEach(() => _resetLoopGuardForTest())
afterEach(() => {
  _resetLoopGuardForTest()
  vi.useRealTimers()
})

describe('allowTelegramInbound', () => {
  test('allows up to the default budget (20), rejects the 21st', () => {
    for (let i = 0; i < 20; i++) {
      expect(allowTelegramInbound('a')).toBe(true)
    }
    expect(allowTelegramInbound('a')).toBe(false)
  })

  test('budgets are independent per agent', () => {
    for (let i = 0; i < 20; i++) allowTelegramInbound('a')
    expect(allowTelegramInbound('a')).toBe(false)
    // A different agent still has its full budget.
    expect(allowTelegramInbound('b')).toBe(true)
  })

  test('cooldown latches: stays rejected for the cooldown window even as the rolling window drains', () => {
    vi.useFakeTimers()
    const start = Date.now()
    vi.setSystemTime(start)
    for (let i = 0; i < 20; i++) allowTelegramInbound('a')
    expect(allowTelegramInbound('a')).toBe(false) // trips, sets 60s cooldown

    // 59s later — the rolling 60s window has nearly drained, but the cooldown
    // is still in effect.
    vi.setSystemTime(start + 59_000)
    expect(allowTelegramInbound('a')).toBe(false)

    // Past the cooldown — budget is available again.
    vi.setSystemTime(start + 61_000)
    expect(allowTelegramInbound('a')).toBe(true)
  })
})

describe('shouldNotifyInboundThrottle', () => {
  test('fires once per cooldown window', () => {
    vi.useFakeTimers()
    const start = Date.now()
    vi.setSystemTime(start)
    for (let i = 0; i < 20; i++) allowTelegramInbound('a')
    allowTelegramInbound('a') // trip

    expect(shouldNotifyInboundThrottle('a')).toBe(true) // first notice
    expect(shouldNotifyInboundThrottle('a')).toBe(false) // suppressed within window

    vi.setSystemTime(start + 61_000)
    expect(shouldNotifyInboundThrottle('a')).toBe(true) // window elapsed → notice again
  })

  test('returns false for an agent that was never seen', () => {
    expect(shouldNotifyInboundThrottle('never')).toBe(false)
  })
})

describe('allowTelegramOutboundNoise', () => {
  test('allows up to the default noise budget (30), rejects the 31st', () => {
    for (let i = 0; i < 30; i++) {
      expect(allowTelegramOutboundNoise('a')).toBe(true)
    }
    expect(allowTelegramOutboundNoise('a')).toBe(false)
  })

  test('no cooldown latch — recovers as the rolling window drains', () => {
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
