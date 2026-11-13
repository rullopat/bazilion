import { existsSync, rmSync } from 'node:fs'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from '../repos/agents.ts'
import * as profileRepo from '../repos/profiles.ts'
import * as teamTemplateRepo from '../repos/teamTemplates.ts'

export function deleteProfile(db: BazilionDb, id: string): void {
  const profile = profileRepo.get(db, id)
  if (!profile) throw new DomainError(404, `profile not found: ${id}`)

  // Check for agents still using this profile
  const agents = agentRepo.list(db, { includeArchived: true }).filter((a) => a.profileId === id)
  if (agents.length > 0) {
    const names = agents.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ')
    throw new DomainError(
      409,
      `cannot delete profile "${id}": ${agents.length} agent(s) still reference it: ${names}. Delete or re-profile them first.`,
    )
  }

  // Team template slots reference Profiles with RESTRICT foreign keys, so surface a stable domain
  // error instead of an opaque SQLite constraint failure.
  const refTemplates = teamTemplateRepo.findReferencingProfile(db, id)
  if (refTemplates.length > 0) {
    const names = refTemplates.map((template) => `${template.name} (${template.id})`).join(', ')
    throw new DomainError(
      409,
      `cannot delete profile "${id}": ${refTemplates.length} Team Template(s) still reference it: ${names}. Remove the slot(s) first.`,
    )
  }

  // Remove from DB (CASCADE deletes profile_default_skills)
  profileRepo.remove(db, id)

  // Remove the profile directory from disk
  if (existsSync(profile.dir)) {
    rmSync(profile.dir, { recursive: true, force: true })
  }
}
