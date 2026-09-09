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
  return {
    image: environment.config.image,
    coding: validateDockerCodingSelection({
      revision: environment.revision,
      cwd: environment.config.cwd,
      env: environment.config.env,
    }),
  }
}
