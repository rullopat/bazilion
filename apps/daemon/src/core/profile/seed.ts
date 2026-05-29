import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Group, Profile } from '@bazilion/api-types'
import { isSetupComplete, listAvailableModels } from '../availableModels.ts'
import type { BazilionDb } from '../db/client.ts'
import { registerGroup } from '../group/register.ts'
import type { Paths } from '../paths.ts'
import * as groupRepo from '../repos/groups.ts'
import * as profileRepo from '../repos/profiles.ts'
import { createProfile } from './create.ts'
import {
  DEFAULT_AGENTS,
  DEFAULT_BOOTSTRAP,
  DEFAULT_IDENTITY,
  DEFAULT_SOUL,
  DEFAULT_TOOLS,
} from './templates.ts'

export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_GROUP_ID = 'default'

// HEARTBEAT.md is intentionally absent — it's opt-in, so the
// managed default profile doesn't ship it.
const DEFAULT_PROFILE_FILES: [string, string][] = [
  ['SOUL.md', DEFAULT_SOUL],
  ['IDENTITY.md', DEFAULT_IDENTITY],
  ['BOOTSTRAP.md', DEFAULT_BOOTSTRAP],
  ['AGENTS.md', DEFAULT_AGENTS],
  ['TOOLS.md', DEFAULT_TOOLS],
]

/**
 * Bring the on-disk `default` profile's template files up to the current
 * defaults. The `default` profile is bazilion-managed — it always reflects
 * the shipped templates, so operators who want a customized template make
 * their own profile (which is never touched here). Pre-1.0, single-user:
 * we just overwrite rather than diffing against historical defaults.
 *
 * Write-if-differs so a steady-state boot is a no-op (and the log stays
 * quiet). No-op when the default profile isn't on disk yet — a fresh install
 * gets the current templates via seedDefaults → createProfile. Returns the
 * names of files that were (re)written.
 */
export function refreshDefaultProfileTemplates(paths: Paths): string[] {
  const dir = paths.profileDir(DEFAULT_PROFILE_ID)
  if (!existsSync(dir)) return []
  const written: string[] = []
  for (const [name, content] of DEFAULT_PROFILE_FILES) {
    const path = join(dir, name)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      writeFileSync(path, content)
      written.push(name)
    }
  }
  return written
}

export interface SeedDefaultsInput {
  /** `provider:model` used as the profile's defaultModel. */
  model: string
}

export interface SeedResult {
  profile: Profile
  group: Group
  /** true if the helper created the profile this call (vs. returned an existing one). */
  profileCreated: boolean
  /** true if the helper created the group this call. */
  groupCreated: boolean
}

/**
 * Seed the on-disk + DB defaults users land on after finishing first-run setup:
 * a `default` group at `~/.bazilion/groups/default/` and a `default` profile
 * wired to the just-enabled model. Fresh agents spawned from the default
 * profile land in the default group unless another is specified.
 *
 * Idempotent: re-seeding reuses whichever pieces already exist, so it's safe
 * to call whenever the setup state changes.
 */
export function seedDefaults(db: BazilionDb, paths: Paths, input: SeedDefaultsInput): SeedResult {
  let group = groupRepo.get(db, DEFAULT_GROUP_ID, paths)
  let groupCreated = false
  if (!group) {
    group = registerGroup(db, { id: DEFAULT_GROUP_ID, name: 'Default' }, paths)
    groupCreated = true
  }

  let profile = profileRepo.get(db, DEFAULT_PROFILE_ID)
  let profileCreated = false
  if (!profile) {
    // skillsMode='all' so freshly-spawned default agents inherit every
    // installed skill — the friendlier first-run posture. Custom profiles
    // still default to 'selected' (createProfile's own default).
    profile = createProfile(db, paths, {
      id: DEFAULT_PROFILE_ID,
      name: 'Default',
      defaultModel: input.model,
      skillsMode: 'all',
    })
    profileCreated = true
  }

  return { profile, group, profileCreated, groupCreated }
}

/**
 * Safe to call from any endpoint that can change setup state (toggling a
 * provider, editing model lists). No-op when either setup isn't complete
 * (nothing to seed against yet) or the default profile already exists.
 * Returns the seed result only on the cold-start transition.
 */
export function ensureSetupSeeded(db: BazilionDb, paths: Paths): SeedResult | null {
  if (!isSetupComplete(db)) return null
  if (profileRepo.get(db, DEFAULT_PROFILE_ID)) return null
  const first = listAvailableModels(db)[0]
  if (!first) return null
  return seedDefaults(db, paths, { model: first.value })
}
