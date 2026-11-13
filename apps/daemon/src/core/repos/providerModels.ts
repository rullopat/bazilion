import type { BazilionDb } from '../db/client.ts'

interface RawRow {
  provider: string
  model: string
  added_at: number
}

/** Curated model names for one provider, in insertion order. */
export function list(db: BazilionDb, provider: string): string[] {
  return db.raw
    .query<RawRow, [string]>(
      'SELECT * FROM provider_models WHERE provider = ? ORDER BY added_at ASC',
    )
    .all(provider)
    .map((r) => r.model)
}

/**
 * Replace the curated list for one provider atomically. Empty `models` clears
 * the list. De-dupes (case-sensitive) and preserves incoming order.
 */
export function replace(db: BazilionDb, provider: string, models: string[]): void {
  const seen = new Set<string>()
  const clean = models
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && !seen.has(m) && seen.add(m))
  db.raw.transaction(() => {
    db.raw.run('DELETE FROM provider_models WHERE provider = ?', [provider])
    const now = Date.now()
    for (let i = 0; i < clean.length; i++) {
      // Offset by index so ordering is preserved by added_at.
      db.raw.run('INSERT INTO provider_models (provider, model, added_at) VALUES (?, ?, ?)', [
        provider,
        clean[i] as string,
        now + i,
      ])
    }
  })()
}
