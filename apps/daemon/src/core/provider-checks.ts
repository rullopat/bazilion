// The outcome of each provider's last test, kept across restarts in one config row so that Setup
// can say "working, tested two days ago" without asking the provider again.

import type { ProviderCheck } from '@bazilion/api-types'
import type { BazilionDb } from './db/client.ts'
import { openConfig, PROVIDER_CHECKS_KEY } from './repos/config.ts'

export function readProviderChecks(db: BazilionDb): Record<string, ProviderCheck> {
  const raw = openConfig(db).get(PROVIDER_CHECKS_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ProviderCheck>) : {}
  } catch {
    return {}
  }
}

/** Record a provider's test, or forget it (`null`) when its credentials or models changed. */
export function writeProviderCheck(
  db: BazilionDb,
  providerId: string,
  check: ProviderCheck | null,
): void {
  const checks = readProviderChecks(db)
  if (check) checks[providerId] = check
  else if (providerId in checks) delete checks[providerId]
  else return
  const store = openConfig(db)
  if (Object.keys(checks).length === 0) store.remove(PROVIDER_CHECKS_KEY)
  else store.set(PROVIDER_CHECKS_KEY, JSON.stringify(checks))
}
