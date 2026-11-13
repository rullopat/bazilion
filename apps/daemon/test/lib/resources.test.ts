import { afterEach, expect, test } from 'vitest'
import type { BrowserSession } from '../../src/lib/browser/pool.ts'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'

afterEach(async () => {
  await shutdownResources()
})

/** A browser session double: `close()` removes it from the registry, like the pool's. */
function fakeSession(agentId: string, idleMs: number, lastUsedAt: number, busy = 0) {
  const state = { closed: false }
  const session = {
    agentId,
    lastUsedAt,
    idleMs,
    busy,
    async close() {
      state.closed = true
      resources().browsers.delete(agentId)
    },
  } as unknown as BrowserSession
  resources().browsers.set(agentId, session)
  return state
}

test('the reaper closes browsers idle past their idleMs and keeps fresh ones', () => {
  const now = 1_000_000
  const stale = fakeSession('stale', 1000, now - 5000)
  const fresh = fakeSession('fresh', 1000, now - 100)
  reapIdleResources(now)
  expect(stale.closed).toBe(true)
  expect(fresh.closed).toBe(false)
  expect([...resources().browsers.keys()]).toEqual(['fresh'])
})

test('the reaper never closes a busy browser', () => {
  const now = 1_000_000
  const busy = fakeSession('busy', 1000, now - 5000, 1)
  reapIdleResources(now)
  expect(busy.closed).toBe(false)
  expect(resources().browsers.has('busy')).toBe(true)
})

test('shutdownResources closes every browser', async () => {
  const a = fakeSession('a', 1000, Date.now())
  const b = fakeSession('b', 1000, Date.now())
  await shutdownResources()
  expect(a.closed && b.closed).toBe(true)
  expect(resources().browsers.size).toBe(0)
})
