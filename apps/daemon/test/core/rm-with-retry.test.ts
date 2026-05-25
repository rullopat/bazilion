import { expect, test, vi } from 'vitest'
import {
  DEFAULT_RM_RETRY_DELAYS_MS,
  rmWithRetry,
} from '../../src/core/profile-group/rm-with-retry.ts'

test('succeeds on first attempt when rm does not throw', async () => {
  const calls: string[] = []
  const ok = await rmWithRetry('/tmp/x', {
    rm: (p) => calls.push(p),
    sleep: async () => {},
  })
  expect(ok).toBe(true)
  expect(calls).toEqual(['/tmp/x'])
})

test('retries with backoff on transient failure, succeeds on second attempt', async () => {
  let attempts = 0
  const sleeps: number[] = []
  const ok = await rmWithRetry('/tmp/x', {
    rm: () => {
      attempts++
      if (attempts === 1) throw new Error('EBUSY')
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  expect(ok).toBe(true)
  expect(attempts).toBe(2)
  // One sleep, at the first delay.
  expect(sleeps).toEqual([100])
})

test('exhausts all retries and returns false', async () => {
  let attempts = 0
  const sleeps: number[] = []
  const ok = await rmWithRetry('/tmp/x', {
    rm: () => {
      attempts++
      throw new Error('always fails')
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  expect(ok).toBe(false)
  // 4 attempts total (initial + 3 retries), 3 sleeps in between.
  expect(attempts).toBe(4)
  expect(sleeps).toEqual([100, 500, 2000])
})

test('respects custom delays array', async () => {
  let attempts = 0
  const sleeps: number[] = []
  await rmWithRetry('/tmp/x', {
    rm: () => {
      attempts++
      throw new Error('x')
    },
    delays: [10, 20],
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  expect(attempts).toBe(3)
  expect(sleeps).toEqual([10, 20])
})

test('DEFAULT_RM_RETRY_DELAYS_MS is the documented [100, 500, 2000]', () => {
  expect([...DEFAULT_RM_RETRY_DELAYS_MS]).toEqual([100, 500, 2000])
})

test('default rm uses real rmSync via setTimeout-backed sleep (smoke)', async () => {
  // Just confirm it returns true for a missing target (force: true).
  const ok = await rmWithRetry('/tmp/bazilion-rm-with-retry-nonexistent-xyz')
  expect(ok).toBe(true)
})

test('does not call sleep after the final attempt', async () => {
  const sleepSpy = vi.fn(async () => {})
  await rmWithRetry('/tmp/x', {
    rm: () => {
      throw new Error('x')
    },
    delays: [1],
    sleep: sleepSpy,
  })
  // 2 attempts, only 1 sleep between them.
  expect(sleepSpy).toHaveBeenCalledTimes(1)
})
