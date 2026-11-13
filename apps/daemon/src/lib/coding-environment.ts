// Optional per-Team defaults for Docker sandbox commands: a local image and a working directory.
// They are used only when BAZILION_BASH_SANDBOX is docker; host turns ignore them.

import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingEnvironmentStatus, ResolvedAgent, Team } from '@bazilion/api-types'
import {
  CodingEnvironmentValidationError,
  validateCodingEnvironment,
} from '../core/coding-environment/config.ts'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import { getCodingEnvironment, putCodingEnvironment } from '../core/repos/coding-environment.ts'
import { turnContainerPrefix } from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import type { DockerTurn } from '../runtime/shell/tooling.ts'

export function codingEnvironmentStatus(
  db: BazilionDb,
  teamId: string,
  env: NodeJS.ProcessEnv = process.env,
): CodingEnvironmentStatus {
  const config = resolveShellSecurityConfig(env)
  return {
    ...getCodingEnvironment(db, teamId),
    sandboxMode: config.sandboxMode,
    defaultImage: config.sandboxImage,
  }
}

/** Validate and save a Team's defaults; the directory must already exist in the Team. */
export function setTeamCodingEnvironment(
  db: BazilionDb,
  team: Team,
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): CodingEnvironmentStatus {
  const environment = validateCodingEnvironment(input)
  // Each component must be a real directory, not a symbolic link: a container resolves links
  // against its own filesystem, not the host's.
  let path = team.path
  for (const part of environment.cwd === '.' ? [] : environment.cwd.split('/')) {
    path = join(path, part)
    if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory())
      throw new CodingEnvironmentValidationError(
        'The directory must be an existing directory inside the Team',
      )
  }
  putCodingEnvironment(db, team.id, environment)
  return codingEnvironmentStatus(db, team.id, env)
}

/** The Docker settings of one turn: the Team's defaults over the installation image. */
export function dockerTurn(
  db: BazilionDb,
  paths: Paths,
  agent: ResolvedAgent,
  env: NodeJS.ProcessEnv,
): DockerTurn {
  const { image, cwd } = getCodingEnvironment(db, agent.team.id)
  return {
    image: image ?? resolveShellSecurityConfig(env).sandboxImage,
    cwd,
    containerPrefix: turnContainerPrefix(paths.home),
  }
}
