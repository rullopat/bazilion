import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import { loadPromptSkills, loadProtectedHomeDocuments } from '../runtime/index.ts'
import { ensureContainedRealDirectory, resolveRealDirectory } from '../runtime/safe-files.ts'
import {
  type DockerReadOnlyMount,
  type ProtectedDockerRuntime,
  preflightProtectedDockerRuntime,
} from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { SANDBOX_INPUTS_DIR, SANDBOX_MEMORY_DIR } from '../runtime/shell/tooling.ts'
import type {
  ProtectedProviderWorkerRuntime,
  ProtectedWorkerPaths,
} from '../runtime/worker/runtime.ts'
import { prepareInputFilesDirectory } from './attachments.ts'
import { getCtx } from './ctx.ts'
import {
  ProtectedExecutionUnavailableError,
  resolveProtectedProviderRuntime,
} from './protected-provider.ts'

const preparedProtectedExecutionBrand: unique symbol = Symbol(
  'bazilion.prepared-protected-execution',
)
const preparedProtectedExecutions = new WeakSet<object>()
const consumedProtectedExecutions = new WeakSet<object>()

export interface PreparedProtectedExecution {
  readonly [preparedProtectedExecutionBrand]: true
  readonly runtime: ProtectedProviderWorkerRuntime
  readonly paths: ProtectedWorkerPaths
  readonly docker: ProtectedDockerRuntime
  readonly refreshApiKey: (providerName: string) => Promise<string>
}

export interface PrepareProtectedExecutionOptions {
  includeUploads?: boolean
  signal?: AbortSignal
}

/** Resolve and preflight every capability needed by one protected normal turn. */
export async function prepareProtectedExecution(
  agent: ResolvedAgent,
  options: PrepareProtectedExecutionOptions = {},
): Promise<PreparedProtectedExecution> {
  const signal = options.signal
  if (signal?.aborted) throw new Error('cancelled')
  const { db, paths, authToken } = getCtx()
  const provider = await resolveProtectedProviderRuntime(db, authToken, agent)
  if (signal?.aborted) throw new Error('cancelled')

  let memoryDir: string
  let sessionDir: string
  let uploadsDir: string | undefined
  let homeDocuments: ReturnType<typeof loadProtectedHomeDocuments>
  try {
    resolveRealDirectory(agent.agent.dir)
    memoryDir = ensureContainedRealDirectory(join(agent.team.path, 'memory'), agent.team.path, {
      create: true,
    })
    sessionDir = ensureContainedRealDirectory(join(agent.agent.dir, 'sessions'), agent.agent.dir, {
      create: true,
    })
    uploadsDir = options.includeUploads ? prepareInputFilesDirectory(agent.agent.dir) : undefined
    homeDocuments = loadProtectedHomeDocuments(agent.agent.dir)
  } catch {
    throw new ProtectedExecutionUnavailableError(
      'Protected Agent paths are unavailable or unsafe. Run `bazilion doctor` for remediation.',
    )
  }

  const skills = loadPromptSkills(paths.skillsDir, agent.skills)
  const workerPaths: ProtectedWorkerPaths = {
    agentDir: agent.agent.dir,
    teamDir: agent.team.path,
    memoryDir,
    sessionDir,
    ...(uploadsDir ? { uploadsDir } : {}),
    skills,
    homeDocuments,
  }

  let image: string
  try {
    // The configured mode and allowlist never select the protected surface.
    // Parsing still fails closed on invalid configuration; only the validated
    // image name is carried into the forced Docker policy.
    image = resolveShellSecurityConfig(mergeSecretsIntoEnv(db, authToken)).sandboxImage
  } catch {
    throw new ProtectedExecutionUnavailableError(
      'Protected Docker configuration is invalid. Run `bazilion doctor` for remediation.',
    )
  }

  const readOnlyMounts: Array<Required<DockerReadOnlyMount>> = [
    { source: memoryDir, target: SANDBOX_MEMORY_DIR, sourceRoot: agent.team.path },
    ...(uploadsDir
      ? [{ source: uploadsDir, target: SANDBOX_INPUTS_DIR, sourceRoot: agent.agent.dir }]
      : []),
    ...skills.map((skill) => ({
      source: skill.hostDir,
      target: skill.sandboxDir,
      sourceRoot: paths.skillsDir,
    })),
  ]

  let docker: ProtectedDockerRuntime
  try {
    docker = await preflightProtectedDockerRuntime({
      image,
      workspaceDir: agent.team.path,
      workspaceRoot: agent.team.path,
      readOnlyMounts,
    })
  } catch {
    throw new ProtectedExecutionUnavailableError(
      'Protected Docker runtime is unavailable. Run `bazilion doctor` for remediation.',
    )
  }
  if (signal?.aborted) throw new Error('cancelled')
  const prepared = {
    [preparedProtectedExecutionBrand]: true as const,
    ...provider,
    paths: workerPaths,
    docker,
  }
  Object.defineProperty(prepared, preparedProtectedExecutionBrand, { enumerable: false })
  deepFreezePreparedProtectedExecution(prepared)
  preparedProtectedExecutions.add(prepared)
  return prepared
}

export function assertPreparedProtectedExecution(
  value: unknown,
  agent: ResolvedAgent,
): asserts value is PreparedProtectedExecution {
  if (
    typeof value !== 'object' ||
    value === null ||
    !preparedProtectedExecutions.has(value) ||
    (value as Partial<PreparedProtectedExecution>)[preparedProtectedExecutionBrand] !== true
  ) {
    throw new Error('protected execution was not prepared by the daemon')
  }
  const prepared = value as PreparedProtectedExecution
  const separator = agent.model.indexOf(':')
  if (
    prepared.paths.agentDir !== agent.agent.dir ||
    prepared.paths.teamDir !== agent.team.path ||
    prepared.runtime.providerName !== agent.model.slice(0, separator) ||
    prepared.runtime.modelId !== agent.model.slice(separator + 1) ||
    prepared.runtime.reasoningLevel !== agent.reasoningLevel
  ) {
    throw new Error('protected execution does not match the resolved Agent')
  }
}

/** Consume one protected preflight exactly once when binding it to a turn. */
export function consumePreparedProtectedExecution(
  value: unknown,
  agent: ResolvedAgent,
): asserts value is PreparedProtectedExecution {
  assertPreparedProtectedExecution(value, agent)
  if (consumedProtectedExecutions.has(value)) {
    throw new Error('protected execution preflight has already been consumed')
  }
  consumedProtectedExecutions.add(value)
}

function deepFreezePreparedProtectedExecution(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) deepFreezePreparedProtectedExecution(child, seen)
  Object.freeze(value)
}
