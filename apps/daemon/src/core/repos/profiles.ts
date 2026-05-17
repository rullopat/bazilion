import type { Profile, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawProfile {
  id: string
  name: string
  dir: string
  default_model: string
  skills_mode: string
  created_at: number
  updated_at: number
}

function toProfile(r: RawProfile): Profile {
  return {
    id: r.id,
    name: r.name,
    dir: r.dir,
    defaultModel: r.default_model,
    skillsMode: r.skills_mode as SkillsMode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function insert(db: BazilionDb, p: Omit<Profile, 'createdAt' | 'updatedAt'>): Profile {
  const now = Date.now()
  db.raw.run(
    `INSERT INTO profiles (id, name, dir, default_model, skills_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.name, p.dir, p.defaultModel, p.skillsMode, now, now],
  )
  return { ...p, createdAt: now, updatedAt: now }
}

export function get(db: BazilionDb, id: string): Profile | null {
  const row = db.raw.query<RawProfile, [string]>('SELECT * FROM profiles WHERE id = ?').get(id)
  return row ? toProfile(row) : null
}

export function list(db: BazilionDb): Profile[] {
  return db.raw
    .query<RawProfile, []>('SELECT * FROM profiles ORDER BY created_at ASC')
    .all()
    .map(toProfile)
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM profiles WHERE id = ?', [id])
}

export function update(
  db: BazilionDb,
  id: string,
  fields: { name: string; defaultModel: string; skillsMode: SkillsMode },
): void {
  db.raw.run(
    `UPDATE profiles
     SET name = ?, default_model = ?, skills_mode = ?, updated_at = ?
     WHERE id = ?`,
    [fields.name, fields.defaultModel, fields.skillsMode, Date.now(), id],
  )
}

export function setDefaultSkills(db: BazilionDb, profileId: string, skills: string[]): void {
  const tx = db.raw.transaction(() => {
    db.raw.run('DELETE FROM profile_default_skills WHERE profile_id = ?', [profileId])
    const stmt = db.raw.query(
      'INSERT INTO profile_default_skills (profile_id, skill_name) VALUES (?, ?)',
    )
    for (const s of skills) stmt.run(profileId, s)
  })
  tx()
}

export function getDefaultSkills(db: BazilionDb, profileId: string): string[] {
  return db.raw
    .query<{ skill_name: string }, [string]>(
      'SELECT skill_name FROM profile_default_skills WHERE profile_id = ? ORDER BY skill_name',
    )
    .all(profileId)
    .map((r) => r.skill_name)
}
