import type { CodingEnvironmentStatus, Team } from '@bazilion/api-types'
import {
  CodingEnvironmentValidationError,
  validateCodingEnvironmentConfig,
} from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import { getCodingEnvironment, putCodingEnvironment } from '../../core/repos/coding-environment.ts'
import { resolveCodingDirectory } from '../../runtime/coding-directory.ts'
import {
  MAC_DOCKER_EXECUTION_UNAVAILABLE,
  MAC_NATIVE_EXECUTION_UNAVAILABLE,
  supportedIsolationBackends,
} from '../../runtime/shell/platform-support.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import { workspaceLifecycle } from './lifecycle.ts'
import { overlappingWorkspaceRoots, workspaceIdentity } from './workspace.ts'
/** Purely synchronous mutation after asynchronous recovery/admission; no child resources. */
export async function mutateTeamWorkspace<T>(
  db: BazilionDb,
  team: Team,
  mutation: () => T,
): Promise<T> {
  const lifecycle = workspaceLifecycle(db)
  const lease = await lifecycle.claim(team.id, team.path, 'mutation')
  try {
    lifecycle.coordinator.assertLease(lease, team.id, team.path)
    return mutation()
  } finally {
    lease.finish(true)
  }
}

export async function configureTeamCodingEnvironment(
  db: BazilionDb,
  team: Team,
  expectedRevision: number,
  input: unknown,
) {
  const config = validateCodingEnvironmentConfig(input)
  if (process.platform === 'darwin')
    throw new CodingEnvironmentValidationError(
      config.backend === 'native'
        ? MAC_NATIVE_EXECUTION_UNAVAILABLE
        : MAC_DOCKER_EXECUTION_UNAVAILABLE,
    )
  return mutateTeamWorkspace(db, team, () => {
    resolveCodingDirectory(team.path, config.cwd)
    return putCodingEnvironment(db, team.id, expectedRevision, config)
  })
}

export async function codingEnvironmentStatus(
  db: BazilionDb,
  team: Team,
  env = process.env,
): Promise<CodingEnvironmentStatus> {
  const root = workspaceIdentity(team.path)
  const recovery = workspaceLifecycle(db)
    .coordinator.recoveryRequired()
    .find(
      (writer) => writer.teamId === team.id || overlappingWorkspaceRoots(root.root, writer.root),
    )
  const environment = getCodingEnvironment(db, team.id),
    config = resolveShellSecurityConfig(env)
  return {
    supportedBackends: supportedIsolationBackends(),
    environment,
    configuredExecution: config.sandboxMode === 'off' ? 'host' : config.sandboxMode,
    image:
      process.platform === 'darwin' ||
      config.sandboxMode === 'native' ||
      environment?.config.backend === 'native'
        ? null
        : (environment?.config.image ?? config.sandboxImage),
    workspaceRecovery: recovery ? (recovery.restored ? 'restored' : 'required') : 'none',
  }
}
