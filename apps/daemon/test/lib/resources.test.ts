import { afterEach, expect, test } from 'vitest'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'

afterEach(async () => {
  await shutdownResources()
})

function fakeBrowser(idleMs: number, lastUsedAt: number) {
  const closed = { value: false }
  return {
    session: {
      agentId: 'x',
      lastUsedAt,
      idleMs,
      // biome-ignore lint/suspicious/noExplicitAny: test double
      browser: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: test double
      context: {} as any,
      activeIndex: 0,
      console: [],
      network: [],
      async close() {
        closed.value = true
      },
    },
    closed,
  }
}

test('reaper closes sessions idle past their idleMs and keeps fresh ones', async () => {
  const now = 1_000_000
  const stale = fakeBrowser(1000, now - 5000) // idle 5s > 1s
  const fresh = fakeBrowser(1000, now - 100) // idle 0.1s < 1s
  resources().browsers.set('stale', stale.session)
  resources().browsers.set('fresh', fresh.session)

  reapIdleResources(now)

  expect(resources().browsers.has('stale')).toBe(false)
  expect(resources().browsers.has('fresh')).toBe(true)
  // allow the fire-and-forget close() to settle
  await Promise.resolve()
  expect(stale.closed.value).toBe(true)
  expect(fresh.closed.value).toBe(false)
})

test('idleMs <= 0 disables reaping for an entry', () => {
  const never = fakeBrowser(0, 0)
  resources().browsers.set('never', never.session)
  reapIdleResources(Number.MAX_SAFE_INTEGER)
  expect(resources().browsers.has('never')).toBe(true)
})

test('shutdownResources closes and clears everything', async () => {
  const a = fakeBrowser(1000, Date.now())
  resources().browsers.set('a', a.session)
  await shutdownResources()
  expect(resources().browsers.size).toBe(0)
  expect(a.closed.value).toBe(true)
})
