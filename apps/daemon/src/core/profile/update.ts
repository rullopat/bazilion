import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, ProfileCommunicationDefaults, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as profileCommunicationDefaultsRepo from '../repos/profileCommunicationDefaults.ts'
import * as profileRepo from '../repos/profiles.ts'

export interface UpdateProfileInput {
  name?: string
  defaultModel?: string
  skillsMode?: SkillsMode
  defaultSkills?: string[]
  communicationDefaults?: ProfileCommunicationDefaults | null
}

/**
 * Update the mutable settings in profile.json + the DB row in lockstep.
 * Profile files (SOUL/IDENTITY/BOOTSTRAP) and the memory backend are NOT
 * touched — those have their own paths.
 */
export function updateProfile(
  db: BazilionDb,
  paths: Paths,
  id: string,
  input: UpdateProfileInput,
): Profile {
  const existing = profileRepo.get(db, id)
  if (!existing) throw new Error(`profile not found: ${id}`)

  const nextSkillsMode: SkillsMode = input.skillsMode ?? existing.skillsMode

  const next = {
    name: input.name ?? existing.name,
    defaultModel: input.defaultModel ?? existing.defaultModel,
    skillsMode: nextSkillsMode,
  }
  profileRepo.update(db, id, next)

  if (input.defaultSkills !== undefined) {
    profileRepo.setDefaultSkills(db, id, input.defaultSkills)
  }
  if (Object.hasOwn(input, 'communicationDefaults')) {
    profileCommunicationDefaultsRepo.set(db, id, input.communicationDefaults ?? null)
  }

  const skills = profileRepo.getDefaultSkills(db, id)
  const profileJson = {
    name: next.name,
    defaultModel: next.defaultModel,
    skillsMode: next.skillsMode,
    defaultSkills: skills,
  }
  writeFileSync(
    join(paths.profileDir(id), 'profile.json'),
    `${JSON.stringify(profileJson, null, 2)}\n`,
  )

  const updated = profileRepo.get(db, id)
  if (!updated) throw new Error(`profile vanished after update: ${id}`)
  return {
    ...updated,
    communicationDefaults: profileCommunicationDefaultsRepo.get(db, id),
  }
}
