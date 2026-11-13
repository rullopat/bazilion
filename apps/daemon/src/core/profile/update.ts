import type { Profile, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as profileRepo from '../repos/profiles.ts'

export interface UpdateProfileInput {
  name?: string
  defaultModel?: string
  skillsMode?: SkillsMode
  defaultSkills?: string[]
}

/** Update a profile's settings. Its template files are edited separately. */
export function updateProfile(db: BazilionDb, id: string, input: UpdateProfileInput): Profile {
  const existing = profileRepo.get(db, id)
  if (!existing) throw new DomainError(404, `profile not found: ${id}`)

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

  const updated = profileRepo.get(db, id)
  if (!updated) throw new Error(`profile vanished after update: ${id}`)
  return updated
}
