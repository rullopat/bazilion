import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as profileRepo from '../repos/profiles.ts'
import { DEFAULT_BOOTSTRAP, DEFAULT_IDENTITY, DEFAULT_SOUL } from './templates.ts'
import { validateSlug } from './validate.ts'

export interface CreateProfileInput {
  id: string
  name?: string
  defaultModel: string
  skillsMode?: SkillsMode
  defaultSkills?: string[]
  templates?: {
    soul?: string
    identity?: string
    /** undefined = default bootstrap, null = skip bootstrap, string = override */
    bootstrap?: string | null
    /** undefined = skip, string = seed with this content */
    agents?: string
    /** undefined = skip, string = seed with this content */
    tools?: string
    /** undefined = skip, string = seed with this content */
    heartbeat?: string
  }
}

export function createProfile(db: BazilionDb, paths: Paths, input: CreateProfileInput): Profile {
  validateSlug(input.id)

  const dir = paths.profileDir(input.id)
  mkdirSync(dir, { recursive: true })

  const soul = input.templates?.soul ?? DEFAULT_SOUL
  const identity = input.templates?.identity ?? DEFAULT_IDENTITY
  const bootstrap =
    input.templates?.bootstrap === null ? null : (input.templates?.bootstrap ?? DEFAULT_BOOTSTRAP)

  writeFileSync(join(dir, 'SOUL.md'), soul)
  writeFileSync(join(dir, 'IDENTITY.md'), identity)
  if (bootstrap !== null) {
    writeFileSync(join(dir, 'BOOTSTRAP.md'), bootstrap)
  }
  if (typeof input.templates?.agents === 'string') {
    writeFileSync(join(dir, 'AGENTS.md'), input.templates.agents)
  }
  if (typeof input.templates?.tools === 'string') {
    writeFileSync(join(dir, 'TOOLS.md'), input.templates.tools)
  }
  if (typeof input.templates?.heartbeat === 'string') {
    writeFileSync(join(dir, 'HEARTBEAT.md'), input.templates.heartbeat)
  }

  const skillsMode: SkillsMode = input.skillsMode ?? 'selected'
  const profileJson = {
    name: input.name ?? input.id,
    defaultModel: input.defaultModel,
    skillsMode,
    defaultSkills: input.defaultSkills ?? [],
  }
  writeFileSync(join(dir, 'profile.json'), `${JSON.stringify(profileJson, null, 2)}\n`)

  const profile = profileRepo.insert(db, {
    id: input.id,
    name: profileJson.name,
    dir,
    defaultModel: input.defaultModel,
    skillsMode,
  })

  if (skillsMode === 'selected' && input.defaultSkills && input.defaultSkills.length > 0) {
    profileRepo.setDefaultSkills(db, input.id, input.defaultSkills)
  }

  return profile
}
