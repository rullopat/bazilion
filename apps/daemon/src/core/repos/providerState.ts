import type { BazilionDb } from '../db/client.ts'

interface RawRow {
  provider_id: string
  enabled: number
  updated_at: number
}

export function isEnabled(db: BazilionDb, providerId: string): boolean {
  const row = db.raw
    .query<RawRow, [string]>('SELECT * FROM provider_state WHERE provider_id = ?')
    .get(providerId)
  return row?.enabled === 1
}

export function setEnabled(db: BazilionDb, providerId: string, enabled: boolean): void {
  db.raw.run(
    `INSERT INTO provider_state (provider_id, enabled, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (provider_id) DO UPDATE SET
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [providerId, enabled ? 1 : 0, Date.now()],
  )
}

/** Set of provider ids currently toggled on. Convenience for batch checks. */
export function listEnabled(db: BazilionDb): Set<string> {
  return new Set(
    db.raw
      .query<{ provider_id: string }, []>(
        'SELECT provider_id FROM provider_state WHERE enabled = 1',
      )
      .all()
      .map((r) => r.provider_id),
  )
}
