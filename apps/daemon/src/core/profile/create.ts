import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, ProfileCommunicationDefaults, SkillsMode } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as profileCommunicationDefaultsRepo from '../repos/profileCommunicationDefaults.ts'
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
  communicationDefaults?: ProfileCommunicationDefaults
  templates?: {
    soul?: string
    identity?: string
    /** undefined = default bootstrap, null = skip bootstrap, string = override */
    bootstrap?: string | null
    /** undefined = default template, null = skip, string = override */
    agents?: string | null
    /** undefined = default template, null = skip, string = override */
    tools?: string | null
    /** opt-in (off by default): null/undefined = skip, string = seed */
    heartbeat?: string | null
  }
}

export function createProfile(db: BazilionDb, paths: Paths, input: CreateProfileInput): Profile {
  validateSlug(input.id)

  const dir = paths.profileDir(input.id)
  mkdirSync(dir, { recursive: true })

  const soul = input.templates?.soul ?? DEFAULT_SOUL
  const identity = input.templates?.identity ?? DEFAULT_IDENTITY
  // SOUL + IDENTITY are always written. BOOTSTRAP/AGENTS/TOOLS are default-on
  // (undefined → default template, null → skip, string → override). HEARTBEAT
  // is the exception: opt-in — only written when an explicit
  // string is supplied (undefined/null → skip).
  const bootstrap =
    input.templates?.bootstrap === null ? null : (input.templates?.bootstrap ?? DEFAULT_BOOTSTRAP)
  const agents =
    input.templates?.agents === null ? null : (input.templates?.agents ?? DEFAULT_AGENTS)
  const tools = input.templates?.tools === null ? null : (input.templates?.tools ?? DEFAULT_TOOLS)
  const heartbeat =
    typeof input.templates?.heartbeat === 'string' ? input.templates.heartbeat : null

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
  if (heartbeat !== null) {
    writeFileSync(join(dir, 'HEARTBEAT.md'), heartbeat)
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
  if (input.communicationDefaults) {
    profileCommunicationDefaultsRepo.set(db, input.id, input.communicationDefaults)
  }

  return input.communicationDefaults
    ? { ...profile, communicationDefaults: input.communicationDefaults }
    : profile
}
