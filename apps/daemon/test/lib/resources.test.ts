import { afterEach, expect, test } from 'vitest'
import type { ManagedBrowserEntry } from '../../src/lib/browser/pool.ts'
import { reapIdleResources, resources, shutdownResources } from '../../src/lib/resources.ts'

afterEach(async () => {
  await shutdownResources()
})

/**
 * A ManagedBrowserEntry double honoring the pool's contract: `close()` is the
 * graceful retirement — the entry removes itself from the registry only once
 * the retirement settles (ownership is never dropped before close).
 */
function fakeBrowser(
  idleMs: number,
  lastUsedAt: number,
  opts: { busy?: number; state?: ManagedBrowserEntry['state']; failClose?: boolean } = {},
) {
  const state = { closed: false }
  const entry: ManagedBrowserEntry = {
    agentId: 'x',
    state: opts.state ?? 'running',
    handle: null,
    posture: 'auto||false',
    lastUsedAt,
    idleMs,
    busy: opts.busy ?? 0,
    failure: null,
    async close() {
      if (opts.failClose) {
        entry.state = 'recovery_required'
        entry.failure = { reasonCode: 'browser_recovery_required', detail: 'close failed (test)' }
        return
      }
      state.closed = true
      entry.state = 'stopping'
      const registry = resources().browsers
      if (registry.get(entry.agentId) === entry) registry.delete(entry.agentId)
    },
  }
  return { entry, state }
}

test('reaper retires sessions idle past their idleMs and keeps fresh ones', async () => {
  const now = 1_000_000
  const stale = fakeBrowser(1000, now - 5000) // idle 5s > 1s
  const fresh = fakeBrowser(1000, now - 100) // idle 0.1s < 1s
  resources().browsers.set('x', stale.entry)
  resources().browsers.set('fresh', fresh.entry)

  reapIdleResources(now)

  // The stale entry removed itself only after its retirement settled.
  expect(resources().browsers.has('x')).toBe(false)
  expect(resources().browsers.has('fresh')).toBe(true)
  expect(stale.state.closed).toBe(true)
  expect(fresh.state.closed).toBe(false)
})

test('the reaper never reaps a busy session (in-flight work is protected)', async () => {
  const now = 1_000_000
  const busy = fakeBrowser(1000, now - 5000, { busy: 1 })
  resources().browsers.set('x', busy.entry)
  reapIdleResources(now)
  expect(resources().browsers.has('x')).toBe(true)
  expect(busy.state.closed).toBe(false)
})

test('idleMs <= 0 disables reaping for an entry', () => {
  const never = fakeBrowser(0, 0)
  resources().browsers.set('x', never.entry)
  reapIdleResources(Number.MAX_SAFE_INTEGER)
  expect(resources().browsers.has('x')).toBe(true)
})

test('a recovery_required slot is never reaped', async () => {
  const now = 1_000_000
  const broken = fakeBrowser(1000, now - 5000, { state: 'recovery_required' })
  resources().browsers.set('x', broken.entry)
  reapIdleResources(now)
  expect(resources().browsers.has('x')).toBe(true)
  expect(broken.state.closed).toBe(false)
})

test('shutdownResources retires everything and drops ownership only as each close settles', async () => {
  const a = fakeBrowser(1000, Date.now())
  resources().browsers.set('x', a.entry)
  await shutdownResources()
  expect(resources().browsers.size).toBe(0)
  expect(a.state.closed).toBe(true)
})
