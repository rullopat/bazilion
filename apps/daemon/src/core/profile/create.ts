import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import type { Paths } from '../paths.ts'
import * as profileRepo from '../repos/profiles.ts'
import {
  DEFAULT_AGENTS,
  DEFAULT_BOOTSTRAP,
  DEFAULT_IDENTITY,
  DEFAULT_SOUL,
  DEFAULT_TOOLS,
} from './templates.ts'
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
    /** undefined = default template, null = skip, string = override */
    agents?: string | null
    /** undefined = default template, null = skip, string = override */
    tools?: string | null
  }
}

export function createProfile(db: BazilionDb, paths: Paths, input: CreateProfileInput): Profile {
  validateSlug(input.id)
  // Checked before any file is written: the templates below would overwrite its files.
  if (profileRepo.get(db, input.id))
    throw new DomainError(400, `profile already exists: ${input.id}`)

  const dir = paths.profileDir(input.id)
  mkdirSync(dir, { recursive: true })

  const soul = input.templates?.soul ?? DEFAULT_SOUL
  const identity = input.templates?.identity ?? DEFAULT_IDENTITY
  // SOUL + IDENTITY are always written. BOOTSTRAP/AGENTS/TOOLS are default-on
  // (undefined → default template, null → skip, string → override).
  const bootstrap =
    input.templates?.bootstrap === null ? null : (input.templates?.bootstrap ?? DEFAULT_BOOTSTRAP)
  const agents =
    input.templates?.agents === null ? null : (input.templates?.agents ?? DEFAULT_AGENTS)
  const tools = input.templates?.tools === null ? null : (input.templates?.tools ?? DEFAULT_TOOLS)

  writeFileSync(join(dir, 'SOUL.md'), soul)
  writeFileSync(join(dir, 'IDENTITY.md'), identity)
  if (bootstrap !== null) {
    writeFileSync(join(dir, 'BOOTSTRAP.md'), bootstrap)
  }
  if (agents !== null) {
    writeFileSync(join(dir, 'AGENTS.md'), agents)
  }
  if (tools !== null) {
    writeFileSync(join(dir, 'TOOLS.md'), tools)
  }

  const skillsMode: SkillsMode = input.skillsMode ?? 'selected'
  const profile = profileRepo.insert(db, {
    id: input.id,
    name: input.name ?? input.id,
    defaultModel: input.defaultModel,
    skillsMode,
  })

  if (skillsMode === 'selected' && input.defaultSkills && input.defaultSkills.length > 0) {
    profileRepo.setDefaultSkills(db, input.id, input.defaultSkills)
  }

  return profile
}
