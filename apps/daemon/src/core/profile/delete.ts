import { existsSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import * as agentRepo from '../repos/agents.ts'
import * as profileGroupRepo from '../repos/profileGroups.ts'
import * as profileRepo from '../repos/profiles.ts'

export function deleteProfile(db: BazilionDb, id: string): void {
  const profile = profileRepo.get(db, id)
  if (!profile) throw new Error(`profile not found: ${id}`)

  // Check for agents still using this profile
  const agents = agentRepo.list(db, { includeArchived: true }).filter((a) => a.profileId === id)
  if (agents.length > 0) {
    const names = agents.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')
    throw new Error(
      `cannot delete profile "${id}": ${agents.length} agent(s) still reference it: ${names}. Delete or re-profile them first.`,
    )
  }

  // Check for profile groups (team templates) still referencing this profile —
  // the FK on profile_group_members.profile_id is RESTRICT, so a raw delete
  // would surface as an opaque SQLite constraint error.
  const refGroups = profileGroupRepo.findReferencingProfile(db, id)
  if (refGroups.length > 0) {
    const names = refGroups.map((g) => `${g.name} (${g.id})`).join(', ')
    throw new Error(
      `cannot delete profile "${id}": ${refGroups.length} profile group(s) still reference it: ${names}. Remove the member(s) first.`,
    )
  }

  // Remove from DB (CASCADE deletes profile_default_skills)
  profileRepo.remove(db, id)

  // Remove the profile directory from disk
  if (existsSync(profile.dir)) {
    rmSync(profile.dir, { recursive: true, force: true })
  }
}
