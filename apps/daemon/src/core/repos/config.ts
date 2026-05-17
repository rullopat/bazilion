// Plaintext config store, backed by the `config` table.
//
// Companion to `secrets.ts` — same key-shaped values, but for the ones that
// don't need confidentiality (server URLs, region slugs, project IDs). Kept
// separate so the /config UI can show plaintext values directly without
// extra masking logic.
//
// The CONFIG_KEYS allowlist (derived from the services registry) is enforced
// here on writes — a typo or accidental misclassification can't put an API
// key in this table.

import type { BazilionDb } from '../db/client.ts'
import { SERVICES } from '../services.ts'

/**
 * Env var names that live in the plaintext config store. Derived from the
 * services registry — any field marked `kind: 'config'` ends up here.
 */
export const CONFIG_KEYS: readonly string[] = SERVICES.flatMap((s) =>
  s.fields.filter((f) => f.kind === 'config').map((f) => f.envVar),
)

const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS)

export function isConfigKey(key: string): boolean {
  return CONFIG_KEY_SET.has(key)
}

interface RawRow {
  key: string
  value: string
  updated_at: number
}

export interface ConfigStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  list(): { key: string; value: string }[]
  getAll(): Record<string, string>
}

export function openConfig(db: BazilionDb): ConfigStore {
  return {
    get(key) {
      const row = db.raw.query<RawRow, [string]>('SELECT * FROM config WHERE key = ?').get(key)
      return row?.value
    },
    set(key, value) {
      if (!isConfigKey(key)) {
        throw new Error(
          `config.set: "${key}" is not a known config key (${CONFIG_KEYS.join(', ')})`,
        )
      }
      db.raw.run(
        `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, Date.now()],
      )
    },
    remove(key) {
      db.raw.run('DELETE FROM config WHERE key = ?', [key])
    },
    list() {
      return db.raw
        .query<RawRow, []>('SELECT * FROM config ORDER BY key ASC')
        .all()
        .map((r) => ({ key: r.key, value: r.value }))
    },
    getAll() {
      const out: Record<string, string> = {}
      for (const r of db.raw.query<RawRow, []>('SELECT * FROM config').all()) {
        out[r.key] = r.value
      }
      return out
    },
  }
}
