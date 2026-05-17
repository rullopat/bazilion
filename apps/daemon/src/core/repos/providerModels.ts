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

/** All curated models grouped by provider. Empty providers are omitted. */
export function listAll(db: BazilionDb): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const row of db.raw
    .query<RawRow, []>('SELECT * FROM provider_models ORDER BY provider ASC, added_at ASC')
    .all()) {
    const bucket = out[row.provider] ?? []
    bucket.push(row.model)
    out[row.provider] = bucket
  }
  return out
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

/** Remove a single curated model. No-op if not present. */
export function remove(db: BazilionDb, provider: string, model: string): void {
  db.raw.run('DELETE FROM provider_models WHERE provider = ? AND model = ?', [provider, model])
}
