import type { ProtectedDockerReadiness } from '../runtime/shell/docker.ts'

interface CachedReadiness {
  key: string
  value?: ProtectedDockerReadiness
  expiresAt: number
  inFlight?: Promise<ProtectedDockerReadiness>
}

export interface ProtectedDockerReadinessCache {
  get(
    key: string,
    probe: () => Promise<ProtectedDockerReadiness>,
  ): Promise<ProtectedDockerReadiness>
}

/**
 * Bound active Docker health probes to one per configured image and TTL.
 * Expired callers receive the last known result while one background refresh
 * runs; the first-ever probe is shared by every concurrent caller.
 */
export function createProtectedDockerReadinessCache(
  ttlMs = 60_000,
  now: () => number = Date.now,
): ProtectedDockerReadinessCache {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error('protected Docker readiness cache TTL must be a positive safe integer')
  }
  let cached: CachedReadiness | undefined

  return {
    async get(key, probe) {
      const current = cached
      const currentTime = now()
      if (current?.key === key) {
        if (current.value && currentTime < current.expiresAt) return current.value
        if (current.inFlight) return current.value ?? current.inFlight
      }

      const stale = current?.key === key ? current.value : undefined
      let refresh: Promise<ProtectedDockerReadiness>
      refresh = probe().then(
        (value) => {
          if (cached?.key === key && cached.inFlight === refresh) {
            cached = { key, value, expiresAt: now() + ttlMs }
          }
          return value
        },
        (error: unknown) => {
          if (cached?.key === key && cached.inFlight === refresh) {
            cached = stale ? { key, value: stale, expiresAt: now() + ttlMs } : undefined
          }
          throw error
        },
      )
      cached = { key, ...(stale ? { value: stale } : {}), expiresAt: 0, inFlight: refresh }

      if (!stale) return refresh
      // No request waits on a refresh once a safe last-known projection exists.
      void refresh.catch(() => undefined)
      return stale
    },
  }
}
