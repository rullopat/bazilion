import type { NotificationSettings } from '@bazilion/api-types'
import { ATTENTION_KINDS } from '../attention.ts'
import type { BazilionDb } from '../db/client.ts'

export interface StoredNotificationSettings extends NotificationSettings {
  /** When notifications were last switched on; older items are never sent. */
  enabledAt: number | null
}

interface Row {
  enabled: number
  kinds_json: string
  timezone: string
  quiet_json: string | null
  enabled_at: number | null
}

export function settings(db: BazilionDb): StoredNotificationSettings {
  const row = db.raw
    .query<Row, []>(
      'SELECT enabled, kinds_json, timezone, quiet_json, enabled_at FROM notification_settings WHERE singleton = 1',
    )
    .get()
  if (!row)
    return {
      enabled: false,
      kinds: [...ATTENTION_KINDS],
      timezone: 'UTC',
      quietHours: null,
      enabledAt: null,
    }
  return {
    enabled: row.enabled === 1,
    kinds: JSON.parse(row.kinds_json),
    timezone: row.timezone,
    quietHours: row.quiet_json === null ? null : JSON.parse(row.quiet_json),
    enabledAt: row.enabled_at,
  }
}

export function save(db: BazilionDb, next: NotificationSettings, now = Date.now()): void {
  const current = settings(db)
  const enabledAt = next.enabled ? (current.enabled ? current.enabledAt : now) : null
  db.raw.run(
    `INSERT INTO notification_settings (singleton, enabled, kinds_json, timezone, quiet_json, enabled_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(singleton) DO UPDATE SET enabled = excluded.enabled, kinds_json = excluded.kinds_json,
       timezone = excluded.timezone, quiet_json = excluded.quiet_json, enabled_at = excluded.enabled_at`,
    [
      next.enabled ? 1 : 0,
      JSON.stringify(next.kinds),
      next.timezone,
      next.quietHours ? JSON.stringify(next.quietHours) : null,
      enabledAt,
    ],
  )
}

/** Keys (`kind:sourceId`) of the Attention items already sent. */
export function notifiedKeys(db: BazilionDb): Set<string> {
  return new Set(
    db.raw
      .query<{ key: string }, []>(
        "SELECT source_kind || ':' || source_id AS key FROM attention_notified",
      )
      .all()
      .map((row) => row.key),
  )
}

export function markNotified(db: BazilionDb, kind: string, sourceId: string, now = Date.now()) {
  db.raw.run(
    'INSERT OR IGNORE INTO attention_notified (source_kind, source_id, notified_at) VALUES (?, ?, ?)',
    [kind, sourceId, now],
  )
}

/** Forget items that are no longer open, so a source that opens again is sent again. */
export function forgetClosed(db: BazilionDb, openKeys: ReadonlySet<string>): void {
  for (const key of notifiedKeys(db)) {
    if (openKeys.has(key)) continue
    const at = key.indexOf(':')
    db.raw.run('DELETE FROM attention_notified WHERE source_kind = ? AND source_id = ?', [
      key.slice(0, at),
      key.slice(at + 1),
    ])
  }
}
