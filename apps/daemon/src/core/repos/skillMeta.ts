import type { SkillMeta } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawMeta {
  name: string
  source: string | null
  imported_at: number | null
}

function toMeta(r: RawMeta): SkillMeta {
  return {
    name: r.name,
    source: r.source,
    importedAt: r.imported_at,
  }
}

export function get(db: BazilionDb, name: string): SkillMeta | null {
  const row = db.raw.query<RawMeta, [string]>('SELECT * FROM skill_meta WHERE name = ?').get(name)
  return row ? toMeta(row) : null
}

export function listAll(db: BazilionDb): SkillMeta[] {
  return db.raw.query<RawMeta, []>('SELECT * FROM skill_meta ORDER BY name ASC').all().map(toMeta)
}

export interface UpsertInput {
  name: string
  source?: string | null
  importedAt?: number | null
}

export function upsert(db: BazilionDb, input: UpsertInput): SkillMeta {
  const existing = get(db, input.name)
  const source = input.source !== undefined ? input.source : (existing?.source ?? null)
  const importedAt =
    input.importedAt !== undefined ? input.importedAt : (existing?.importedAt ?? null)
  db.raw.run(
    `INSERT INTO skill_meta (name, source, imported_at)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET source = excluded.source, imported_at = excluded.imported_at`,
    [input.name, source, importedAt],
  )
  return { name: input.name, source, importedAt }
}

export function remove(db: BazilionDb, name: string): void {
  db.raw.run('DELETE FROM skill_meta WHERE name = ?', [name])
}
