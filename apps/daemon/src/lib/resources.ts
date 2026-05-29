// Process-lifetime registry for long-lived, stateful agent resources:
//   - browser sessions (one Playwright context per agent), and
//   - MCP server connections (one client per configured server).
//
// Neither fits the per-turn worker model (a fresh subprocess that holds no
// state and dies at turn end), so they live here in the daemon and the worker
// reaches them over IPC. Pinned to `globalThis` via a well-known Symbol — the
// same pattern as the scheduler and agent-cancel registry — so there is
// exactly one instance per process even if a bundler splits this module.
//
// An idle reaper closes anything untouched for longer than its `idleMs`. It is
// started lazily the first time a resource is created (no timer when nothing
// is open) and runs until shutdown, which closes everything.

import type { BrowserSession } from './browser/pool.ts'
import { closeSsrfProxy } from './browser/proxy.ts'
import type { McpConnection } from './mcp/pool.ts'

const REGISTRY_KEY = Symbol.for('bazilion.resources')

const REAP_TICK_MS = Number.parseInt(process.env.BAZILION_RESOURCE_REAP_TICK_MS ?? '', 10) || 30_000

interface ResourceRegistry {
  browsers: Map<string, BrowserSession>
  mcp: Map<string, McpConnection>
  reaper: NodeJS.Timeout | null
}

export function resources(): ResourceRegistry {
  const g = globalThis as unknown as Record<symbol, ResourceRegistry | undefined>
  let r = g[REGISTRY_KEY]
  if (!r) {
    r = { browsers: new Map(), mcp: new Map(), reaper: null }
    g[REGISTRY_KEY] = r
  }
  return r
}

interface Reapable {
  lastUsedAt: number
  idleMs: number
  close(): Promise<void>
}

function reapMap<T extends Reapable>(map: Map<string, T>, now: number): void {
  for (const [key, entry] of map) {
    if (entry.idleMs > 0 && entry.lastUsedAt + entry.idleMs <= now) {
      map.delete(key)
      void entry.close().catch(() => {})
    }
  }
}

/** Close every resource idle past its `idleMs` as of `now`. Exported for tests. */
export function reapIdleResources(now: number = Date.now()): void {
  const r = resources()
  reapMap(r.browsers, now)
  reapMap(r.mcp, now)
}

/** Start the idle reaper if it isn't already running. Idempotent. */
export function ensureResourceReaper(): void {
  const r = resources()
  if (r.reaper) return
  const timer = setInterval(() => {
    reapIdleResources(Date.now())
  }, REAP_TICK_MS)
  // Don't keep the event loop alive solely for the reaper.
  timer.unref()
  r.reaper = timer
}

/** Close every open resource and stop the reaper. Called on daemon shutdown. */
export async function shutdownResources(): Promise<void> {
  const r = resources()
  if (r.reaper) {
    clearInterval(r.reaper)
    r.reaper = null
  }
  const closing: Array<Promise<void>> = []
  for (const [, s] of r.browsers) closing.push(s.close().catch(() => {}))
  for (const [, c] of r.mcp) closing.push(c.close().catch(() => {}))
  r.browsers.clear()
  r.mcp.clear()
  closing.push(closeSsrfProxy().catch(() => {}))
  await Promise.all(closing)
}
