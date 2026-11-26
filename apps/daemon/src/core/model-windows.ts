// The context windows set by hand, by `provider:model`, kept in one config row. A window set here
// is used for a model whose window neither Pi's catalog nor the model's server says: a local
// server that does not report it, or a custom model on a hosted provider's endpoint.

import type { BazilionDb } from './db/client.ts'
import { MODEL_WINDOWS_KEY, openConfig } from './repos/config.ts'

export function readModelWindows(db: BazilionDb): Record<string, number> {
  const raw = openConfig(db).get(MODEL_WINDOWS_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] > 0,
      ),
    )
  } catch {
    return {}
  }
}

/** The window set by hand for `provider:model`, or null. */
export function modelWindowSetting(db: BazilionDb, model: string): number | null {
  return readModelWindows(db)[model] ?? null
}

/** Set a model's window, or forget it (`null`). */
export function writeModelWindow(db: BazilionDb, model: string, tokens: number | null): void {
  const windows = readModelWindows(db)
  if (tokens === null) {
    if (!(model in windows)) return
    delete windows[model]
  } else {
    windows[model] = tokens
  }
  const store = openConfig(db)
  if (Object.keys(windows).length === 0) store.remove(MODEL_WINDOWS_KEY)
  else store.set(MODEL_WINDOWS_KEY, JSON.stringify(windows))
}
