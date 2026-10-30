import type { CodingEnvironmentValues } from '@bazilion/api-types'
import { CodingEnvironmentValidationError } from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import { getCodingEnvironment } from '../../core/repos/coding-environment.ts'
import {
  type DockerCodingSelection,
  validateDockerCodingSelection,
} from '../../runtime/shell/coding.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'

/** Passive selection only: does not run Docker, version commands or project code. */
export function resolveTeamCodingEnvironment(
  db: BazilionDb,
  teamId: string,
  env: NodeJS.ProcessEnv,
): { image: string; coding?: DockerCodingSelection } {
  const fallback = resolveShellSecurityConfig(env).sandboxImage
  const environment = getCodingEnvironment(db, teamId)
  if (!environment) return { image: fallback }
  if (environment.config.backend !== 'docker')
    throw new CodingEnvironmentValidationError(
      'Saved native defaults cannot select Docker execution',
    )
  return {
    image: environment.config.image,
    coding: validateDockerCodingSelection({
      revision: environment.revision,
      cwd: environment.config.cwd,
      env: environment.config.env,
    }),
  }
}

export interface NativeCodingSelection {
  readonly revision: number
  readonly cwd: string
  readonly env: CodingEnvironmentValues
}
/** Passive native defaults only: no image inference, executable discovery or readiness claim. */
export function resolveTeamNativeCodingEnvironment(
  db: BazilionDb,
  teamId: string,
): NativeCodingSelection {
  const environment = getCodingEnvironment(db, teamId)
  if (!environment) return { revision: 0, cwd: '.', env: {} }
  if (environment.config.backend !== 'native')
    throw new CodingEnvironmentValidationError(
      'Saved Docker defaults cannot select native execution',
    )
  return {
    revision: environment.revision,
    cwd: environment.config.cwd,
    env: { ...environment.config.env },
  }
}
