import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LoadedProfile } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as profileRepo from '../repos/profiles.ts'
import { identityHasValues, parseIdentityMarkdown } from './identity.ts'

function readOptional(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function loadProfile(db: BazilionDb, id: string): LoadedProfile {
  const profile = profileRepo.get(db, id)
  if (!profile) throw new DomainError(404, `profile not found: ${id}`)

  const soul = readFileSync(join(profile.dir, 'SOUL.md'), 'utf8')
  const identityRaw = readFileSync(join(profile.dir, 'IDENTITY.md'), 'utf8')
  const bootstrap = readOptional(join(profile.dir, 'BOOTSTRAP.md'))
  const agents = readOptional(join(profile.dir, 'AGENTS.md'))
  const tools = readOptional(join(profile.dir, 'TOOLS.md'))

  const parsedIdentity = parseIdentityMarkdown(identityRaw)

  return {
    profile,
    defaultSkills: profileRepo.getDefaultSkills(db, id),
    files: {
      soul,
      identity: identityRaw,
      bootstrap,
      agents,
      tools,
    },
    identity: identityHasValues(parsedIdentity) ? parsedIdentity : null,
  }
}
