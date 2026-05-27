// Outbound queue tests — serialization, min-interval pacing, 429 retry.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  _resetOutboundQueueForTest,
  enqueueOutbound,
} from '../../src/lib/telegram/outbound-queue.ts'

const CHAT_A = -1003964430972
const CHAT_B = -1009999

beforeEach(() => _resetOutboundQueueForTest())
afterEach(() => _resetOutboundQueueForTest())

describe('enqueueOutbound', () => {
  test('runs the function and returns its value', async () => {
    const result = await enqueueOutbound(CHAT_A, async () => 'hello', { minIntervalMs: 0 })
    expect(result).toBe('hello')
  })

  test('serializes consecutive enqueues for the same chat', async () => {
    const order: string[] = []
    const a = enqueueOutbound(
      CHAT_A,
      async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('a-end')
        return 'a'
      },
      { minIntervalMs: 0 },
    )
    const b = enqueueOutbound(
      CHAT_A,
      async () => {
        order.push('b-start')
        order.push('b-end')
        return 'b'
      },
      { minIntervalMs: 0 },
    )
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe('a')
    expect(rb).toBe('b')
    // b cannot start before a finishes.
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  test('different chats run in parallel (no cross-chat serialization)', async () => {
    const order: string[] = []
    const a = enqueueOutbound(
      CHAT_A,
      async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 30))
        order.push('a-end')
      },
      { minIntervalMs: 0 },
    )
    const b = enqueueOutbound(
      CHAT_B,
      async () => {
        order.push('b-start')
        order.push('b-end')
      },
      { minIntervalMs: 0 },
    )
    await Promise.all([a, b])
    // B runs to completion while A is still sleeping.
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'))
  })

  test('enforces minimum interval between sends to the same chat', async () => {
    const t0 = Date.now()
    await enqueueOutbound(CHAT_A, async () => 'x', { minIntervalMs: 0 })
    const startSecond = Date.now()
    await enqueueOutbound(CHAT_A, async () => 'y', { minIntervalMs: 50 })
    const endSecond = Date.now()
    // The pacing waits 50ms before the second call's body even runs.
    expect(endSecond - startSecond).toBeGreaterThanOrEqual(45)
    expect(endSecond - t0).toBeGreaterThanOrEqual(45)
  })

  test('a failure in one task does not break the chain', async () => {
    const failing = enqueueOutbound(
      CHAT_A,
      async () => {
        throw new Error('boom')
      },
      { minIntervalMs: 0 },
    )
    await expect(failing).rejects.toThrow('boom')

    const recovered = await enqueueOutbound(CHAT_A, async () => 'survived', { minIntervalMs: 0 })
    expect(recovered).toBe('survived')
  })

  test('retries once on 429 then propagates if still failing', async () => {
    let calls = 0
    const result = await enqueueOutbound(
      CHAT_A,
      async () => {
        calls += 1
        if (calls === 1) {
          const e = Object.assign(new Error('Too Many Requests: retry after 0'), {
            error_code: 429,
            parameters: { retry_after: 0 },
          })
          throw e
        }
        return 'ok'
      },
      { minIntervalMs: 0 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  test('non-429 errors bubble immediately (no retry)', async () => {
    let calls = 0
    await expect(
      enqueueOutbound(
        CHAT_A,
        async () => {
          calls += 1
          throw new Error('connection refused')
        },
        { minIntervalMs: 0 },
      ),
    ).rejects.toThrow('connection refused')
    expect(calls).toBe(1)
  })
})
