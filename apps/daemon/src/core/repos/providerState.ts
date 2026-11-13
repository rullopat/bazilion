import type { BazilionDb } from '../db/client.ts'

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
