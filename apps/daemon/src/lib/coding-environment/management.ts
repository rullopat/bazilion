import type { CodingEnvironmentStatus, Team } from '@bazilion/api-types'
import { validateCodingEnvironmentConfig } from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import { getCodingEnvironment, putCodingEnvironment } from '../../core/repos/coding-environment.ts'
import { resolveCodingDirectory } from '../../runtime/coding-directory.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import { workspaceLifecycle } from './lifecycle.ts'
import { resolveTeamCodingEnvironment } from './resolve.ts'
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
  return {
    environment: getCodingEnvironment(db, team.id),
    configuredExecution:
      resolveShellSecurityConfig(env).sandboxMode === 'docker' ? 'docker' : 'host',
    image: resolveTeamCodingEnvironment(db, team.id, env).image,
    workspaceRecovery: recovery ? (recovery.restored ? 'restored' : 'required') : 'none',
  }
}
