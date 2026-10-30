import type { ResolvedAgent } from '@bazilion/api-types'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import type { DockerCodingSelection } from '../runtime/shell/coding.ts'
import {
  DockerPreflightError,
  type DockerReadOnlyMount,
  type DockerResourceLifecycle,
  type ProtectedDockerRuntime,
  preflightProtectedDockerRuntime,
} from '../runtime/shell/docker.ts'
import { MAC_PROTECTED_EXECUTION_UNAVAILABLE } from '../runtime/shell/platform-support.ts'
import { SANDBOX_INPUTS_DIR, SANDBOX_MEMORY_DIR } from '../runtime/shell/tooling.ts'
import type {
  ProtectedProviderWorkerRuntime,
  ProtectedWorkerPaths,
} from '../runtime/worker/runtime.ts'
import { prepareAgentExecutionPaths } from './agent-execution-inputs.ts'
import { workspaceLifecycle } from './coding-environment/lifecycle.ts'
import { resolveTeamCodingEnvironment } from './coding-environment/resolve.ts'
import type { DaemonCtx } from './ctx.ts'
import { getCtx } from './ctx.ts'
import type { PrepareAgentNativeInputsOptions } from './native-execution/prepare.ts'
import {
  assertPreparedProtectedNativeExecution,
  consumePreparedProtectedNativeExecution,
  isPreparedProtectedNativeExecution,
  type PreparedProtectedNativeExecution,
  prepareProtectedNativeExecution,
} from './native-execution/protected.ts'
import { resolveProtectedExecutionBackend } from './native-execution/selection.ts'
import {
  ProtectedExecutionUnavailableError,
  resolveProtectedProviderRuntime,
} from './protected-provider.ts'

const preparedProtectedExecutionBrand: unique symbol = Symbol(
  'bazilion.prepared-protected-execution',
)
const preparedProtectedExecutions = new WeakSet<object>()
const consumedProtectedExecutions = new WeakSet<object>()
const selectedBackends = new WeakMap<object, 'native' | 'docker'>()
const selectedBackend = (ctx: DaemonCtx) =>
  resolveProtectedExecutionBackend(mergeSecretsIntoEnv(ctx.db, ctx.authToken))

export type PreparedProtectedExecution =
  | PreparedDockerProtectedExecution
  | PreparedProtectedNativeExecution
export interface PreparedDockerProtectedExecution {
  readonly backend: 'docker'
  readonly nativeExecution?: never
  readonly host?: never
  readonly [preparedProtectedExecutionBrand]: true
  readonly runtime: ProtectedProviderWorkerRuntime
  readonly paths: ProtectedWorkerPaths
  readonly docker: ProtectedDockerRuntime
  readonly refreshApiKey: (providerName: string) => Promise<string>
}

export interface PrepareProtectedExecutionOptions {
  readonly backend?: 'docker'
  dockerLifecycle?: DockerResourceLifecycle
  includeUploads?: boolean
  signal?: AbortSignal
}

export interface PrepareNativeProtectedExecutionOptions extends PrepareAgentNativeInputsOptions {
  readonly backend: 'native'
}
/** Resolve and preflight every capability needed by one protected normal turn. */
export function prepareProtectedExecution(
  agent: ResolvedAgent,
  options: PrepareNativeProtectedExecutionOptions,
): Promise<PreparedProtectedNativeExecution>
export function prepareProtectedExecution(
  agent: ResolvedAgent,
  options?: PrepareProtectedExecutionOptions,
): Promise<PreparedDockerProtectedExecution>
export async function prepareProtectedExecution(
  agent: ResolvedAgent,
  options: PrepareProtectedExecutionOptions | PrepareNativeProtectedExecutionOptions = {},
): Promise<PreparedProtectedExecution> {
  if (process.platform === 'darwin')
    throw new ProtectedExecutionUnavailableError(MAC_PROTECTED_EXECUTION_UNAVAILABLE)
  if (options.backend === 'native') return prepareProtectedNativeExecution(getCtx(), agent, options)
  const signal = options.signal
  if (signal?.aborted) throw new Error('cancelled')
  const { db, authToken } = getCtx()
  const provider = await resolveProtectedProviderRuntime(db, authToken, agent)
  if (signal?.aborted) throw new Error('cancelled')

  const inputs = await prepareAgentDockerInputs(agent, options)
  if (signal?.aborted) throw new Error('cancelled')
  const prepared = {
    [preparedProtectedExecutionBrand]: true as const,
    backend: 'docker' as const,
    ...provider,
    ...inputs,
  }
  Object.defineProperty(prepared, preparedProtectedExecutionBrand, { enumerable: false })
  deepFreezePreparedProtectedExecution(prepared)
  preparedProtectedExecutions.add(prepared)
  return prepared
}

export { assertSelectedNativeBackend } from './native-execution/selection.ts'

/** Before approved cutover retain legacy Docker selection; native never falls back. */
export async function prepareSelectedProtectedExecution(
  agent: ResolvedAgent,
  options: Omit<PrepareAgentNativeInputsOptions, 'assertSelection'> & {
    readonly expectedBackend?: 'native' | 'docker'
  },
): Promise<PreparedProtectedExecution> {
  const ctx = getCtx(),
    backend = selectedBackend(ctx)
  if (options.expectedBackend !== undefined && options.expectedBackend !== backend)
    throw new ProtectedExecutionUnavailableError(
      'Protected execution selection changed; prepare a new turn.',
    )
  const prepared =
    backend === 'native'
      ? await prepareProtectedExecution(agent, {
          lease: options.lease,
          controller: options.controller,
          turnId: options.turnId,
          includeUploads: options.includeUploads,
          backend: 'native',
          assertSelection: () => {
            if (selectedBackend(ctx) !== backend)
              throw new ProtectedExecutionUnavailableError(
                'Protected execution selection changed; prepare a new turn.',
              )
          },
        })
      : await prepareProtectedExecution(agent, {
          backend: 'docker',
          signal: options.controller.signal,
          includeUploads: options.includeUploads,
          dockerLifecycle: workspaceLifecycle(ctx.db).containers(options.lease),
        })
  if (selectedBackend(ctx) !== backend) {
    const native = isPreparedProtectedNativeExecution(prepared) ? prepared : undefined
    const closed = native ? await native.close().catch(() => false) : true
    await workspaceLifecycle(ctx.db).release(options.lease)
    if (!closed && native) await native.close().catch(() => false)
    throw new ProtectedExecutionUnavailableError(
      'Protected execution selection changed; prepare a new turn.',
    )
  }
  selectedBackends.set(prepared, backend)
  return prepared
}

/** Shared inspected mounts and Docker selection for configured/protected coding turns. */
export async function prepareAgentDockerInputs(
  agent: ResolvedAgent,
  options: PrepareProtectedExecutionOptions = {},
): Promise<{ paths: ProtectedWorkerPaths; docker: ProtectedDockerRuntime }> {
  options.signal?.throwIfAborted()
  const { db, paths, authToken } = getCtx()
  const workerPaths = prepareAgentExecutionPaths(paths, agent, options.includeUploads)
  const { memoryDir, uploadsDir, skills } = workerPaths

  let image: string
  let coding: DockerCodingSelection | undefined
  try {
    // The configured mode and allowlist never select the protected surface.
    // Parsing still fails closed on invalid configuration; only the validated
    // image name is carried into the forced Docker policy.
    const selection = resolveTeamCodingEnvironment(
      db,
      agent.team.id,
      mergeSecretsIntoEnv(db, authToken),
    )
    image = selection.image
    coding = selection.coding
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
      signal: options.signal,
      lifecycle: options.dockerLifecycle,
      ...(coding ? { coding } : {}),
      workspaceDir: agent.team.path,
      workspaceRoot: agent.team.path,
      readOnlyMounts,
    })
  } catch (error) {
    // Publish only the daemon-authored boundary, never the Docker error/cause or host paths.
    const phase =
      error instanceof DockerPreflightError
        ? ` (${error.phase}${error.kind === 'timeout' ? ': timeout' : ''})`
        : ''
    throw new ProtectedExecutionUnavailableError(
      `Protected Docker runtime is unavailable${phase}. Run \`bazilion doctor\` for remediation.`,
    )
  }
  options.signal?.throwIfAborted()
  return { paths: workerPaths, docker }
}

export function assertPreparedProtectedExecution(
  value: unknown,
  agent: ResolvedAgent,
  turnId?: string,
): asserts value is PreparedProtectedExecution {
  if (isPreparedProtectedNativeExecution(value)) {
    if (!turnId) throw new Error('native protected execution requires its bound turn')
    assertPreparedProtectedNativeExecution(value, agent, turnId)
    return
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !preparedProtectedExecutions.has(value) ||
    (value as Partial<PreparedDockerProtectedExecution>)[preparedProtectedExecutionBrand] !== true
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
  turnId?: string,
): asserts value is PreparedProtectedExecution {
  const selected = value && typeof value === 'object' ? selectedBackends.get(value) : undefined
  if (selected && selectedBackend(getCtx()) !== selected)
    throw new ProtectedExecutionUnavailableError(
      'Protected execution selection changed; prepare a new turn.',
    )
  if (isPreparedProtectedNativeExecution(value)) {
    if (!turnId) throw new Error('native protected execution requires its bound turn')
    consumePreparedProtectedNativeExecution(value, agent, turnId)
    return
  }
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
