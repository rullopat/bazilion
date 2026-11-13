import { DEFAULT_PROFILE_ID, DEFAULT_TEAM_ID, type Profile, type Team } from '@bazilion/api-types'
import { isSetupComplete, listAvailableModels } from '../availableModels.ts'
import type { BazilionDb } from '../db/client.ts'
import type { Paths } from '../paths.ts'
import * as profileRepo from '../repos/profiles.ts'
import * as teamRepo from '../repos/teams.ts'
import { registerTeam } from '../team/register.ts'
import { createProfile } from './create.ts'

export interface SeedDefaultsInput {
  /** `provider:model` used as the profile's defaultModel. */
  model: string
}

export interface SeedResult {
  profile: Profile
  team: Team
}

/**
 * Seed the on-disk + DB defaults users land on after finishing first-run setup:
 * a `default` team at `~/.bazilion/teams/default/` and a `default` profile
 * wired to the just-enabled model. Fresh agents spawned from the default
 * profile land in the default team unless another is specified.
 *
 * Idempotent: re-seeding reuses whichever pieces already exist, so it's safe
 * to call whenever the setup state changes.
 */
function seedDefaults(db: BazilionDb, paths: Paths, input: SeedDefaultsInput): SeedResult {
  let team = teamRepo.get(db, DEFAULT_TEAM_ID, paths)
  if (!team) {
    team = registerTeam(db, { id: DEFAULT_TEAM_ID, name: 'Default' }, paths)
  }

  let profile = profileRepo.get(db, DEFAULT_PROFILE_ID)
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
  }

  return { profile, team }
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
