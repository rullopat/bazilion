import { rmSync } from 'node:fs'

export const DEFAULT_RM_RETRY_DELAYS_MS = [100, 500, 2000] as const

export interface RmRetryOptions {
  /** Injectable rm fn for tests. Defaults to `rmSync(target, { recursive, force })`. */
  rm?: (target: string) => void
  /** Backoff between attempts. Defaults to [100, 500, 2000]. */
  delays?: readonly number[]
  /** Injectable sleep for tests. Defaults to `setTimeout`-backed promise. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Retry filesystem removal with backoff. Returns true if the target is
 * gone after some attempt, false if every attempt failed. Used during
 * profile-team spawn rollback to clean up agent dirs created by
 * successful `spawnAgent` calls before the failing slot.
 *
 * The default rm is `rmSync(target, { recursive: true, force: true })` —
 * `force: true` swallows ENOENT, so a missing target counts as success.
 */
export async function rmWithRetry(target: string, opts: RmRetryOptions = {}): Promise<boolean> {
  const rm = opts.rm ?? ((p: string) => rmSync(p, { recursive: true, force: true }))
  const delays = opts.delays ?? DEFAULT_RM_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      rm(target)
      return true
    } catch {
      if (attempt === delays.length) return false
      const delay = delays[attempt] ?? 0
      await sleep(delay)
    }
  }
  return false
}
