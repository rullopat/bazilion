import type {
  ProfileGroup,
  ProfileGroupMember,
  ProfileGroupWithCount,
  ReasoningLevel,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawProfileGroup {
  id: string
  name: string
  user_md: string | null
  created_at: number
  updated_at: number
}

interface RawProfileGroupWithCount extends RawProfileGroup {
  member_count: number
}

interface RawProfileGroupMember {
  profile_group_id: string
  position: number
  profile_id: string
  agent_name: string
  model_override: string | null
  reasoning_level: string | null
}

function toProfileGroup(r: RawProfileGroup): ProfileGroup {
  return {
    id: r.id,
    name: r.name,
    userMd: r.user_md,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function toMember(r: RawProfileGroupMember): ProfileGroupMember {
  return {
    profileGroupId: r.profile_group_id,
    position: r.position,
    profileId: r.profile_id,
    agentName: r.agent_name,
    modelOverride: r.model_override,
    reasoningLevel: r.reasoning_level as ReasoningLevel | null,
  }
}

export function insert(
  db: BazilionDb,
  p: Omit<ProfileGroup, 'createdAt' | 'updatedAt'>,
): ProfileGroup {
  const now = Date.now()
  db.raw.run(
    `INSERT INTO profile_groups (id, name, user_md, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [p.id, p.name, p.userMd, now, now],
  )
  return { ...p, createdAt: now, updatedAt: now }
}

export function get(db: BazilionDb, id: string): ProfileGroup | null {
  const row = db.raw
    .query<RawProfileGroup, [string]>('SELECT * FROM profile_groups WHERE id = ?')
    .get(id)
  return row ? toProfileGroup(row) : null
}

export function list(db: BazilionDb): ProfileGroupWithCount[] {
  return db.raw
    .query<RawProfileGroupWithCount, []>(
      `SELECT pg.*, COALESCE(m.cnt, 0) AS member_count
       FROM profile_groups pg
       LEFT JOIN (
         SELECT profile_group_id, COUNT(*) AS cnt
         FROM profile_group_members
         GROUP BY profile_group_id
       ) m ON m.profile_group_id = pg.id
       ORDER BY pg.created_at ASC`,
    )
    .all()
    .map((r) => ({ ...toProfileGroup(r), memberCount: r.member_count }))
}

export interface UpdateProfileGroupPatch {
  name?: string
  /** Pass `null` to clear; omit to leave unchanged. */
  userMd?: string | null
}

export function update(db: BazilionDb, id: string, patch: UpdateProfileGroupPatch): void {
  // Distinguish `undefined` (don't touch) from `null` (set NULL). Use
  // Object.hasOwn so an explicit `null` in the patch is honored.
  const sets: string[] = []
  const args: (string | number | null)[] = []
  if (Object.hasOwn(patch, 'name')) {
    sets.push('name = ?')
    args.push(patch.name as string)
  }
  if (Object.hasOwn(patch, 'userMd')) {
    sets.push('user_md = ?')
    args.push(patch.userMd ?? null)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  args.push(Date.now())
  args.push(id)
  db.raw.run(`UPDATE profile_groups SET ${sets.join(', ')} WHERE id = ?`, args)
}

export function remove(db: BazilionDb, id: string): void {
  db.raw.run('DELETE FROM profile_groups WHERE id = ?', [id])
}

export function members(db: BazilionDb, profileGroupId: string): ProfileGroupMember[] {
  return db.raw
    .query<RawProfileGroupMember, [string]>(
      `SELECT * FROM profile_group_members
       WHERE profile_group_id = ?
       ORDER BY position ASC`,
    )
    .all(profileGroupId)
    .map(toMember)
}

export type MemberInput = Omit<ProfileGroupMember, 'profileGroupId' | 'position'>

/**
 * PUT-replace semantics: delete every existing member for this profile group,
 * then re-insert each item in `newMembers` with `position` = array index.
 * Wrapped in a transaction so a partial failure rolls back.
 *
 * Duplicate `agentName` values across members are accepted here — the spawn
 * op resolves collisions with `-2`, `-3`, ... suffixes at spawn time.
 */
export function replaceMembers(
  db: BazilionDb,
  profileGroupId: string,
  newMembers: MemberInput[],
): void {
  const tx = db.raw.transaction(() => {
    db.raw.run('DELETE FROM profile_group_members WHERE profile_group_id = ?', [profileGroupId])
    const stmt = db.raw.query(
      `INSERT INTO profile_group_members
       (profile_group_id, position, profile_id, agent_name, model_override, reasoning_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (let i = 0; i < newMembers.length; i++) {
      const m = newMembers[i]
      if (!m) continue
      stmt.run(
        profileGroupId,
        i,
        m.profileId,
        m.agentName,
        m.modelOverride ?? null,
        m.reasoningLevel ?? null,
      )
    }
  })
  tx()
}
