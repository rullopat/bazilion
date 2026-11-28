import type { Profile, SkillsMode } from './entities.ts'

export interface CreateProfileRequest {
  id: string
  name?: string
  defaultModel: string
  skillsMode?: SkillsMode
  defaultSkills?: string[]
  /** Initial SOUL.md content. Falls back to the built-in template when omitted. */
  soul?: string
  /** Initial IDENTITY.md content. Falls back to the built-in template when omitted. */
  identity?: string
  /** Initial BOOTSTRAP.md content. Omit for default; pass null to skip bootstrap entirely. */
  bootstrap?: string | null
}

export interface UpdateProfileRequest {
  name?: string
  defaultModel?: string
  skillsMode?: SkillsMode
  defaultSkills?: string[]
}

/** One entry of `GET /api/profiles`. */
export interface ProfileSummary extends Profile {
  agentCount: number
  defaultSkills: string[]
}

/** `GET /api/profiles/_/templates`: the built-in starter text of each template file. */
export interface ProfileTemplates {
  soul: string
  identity: string
  bootstrap: string
}

export type ProfileFileName = 'SOUL.md' | 'IDENTITY.md' | 'BOOTSTRAP.md'

export const PROFILE_FILES: ProfileFileName[] = ['SOUL.md', 'IDENTITY.md', 'BOOTSTRAP.md']

export interface FileContentResponse {
  content: string
}

export interface PutFileRequest {
  content: string
}
