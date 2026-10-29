import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeExecutionAdmission, ResolvedAgent } from '@bazilion/api-types'
import { mergeSecretsIntoEnv, resolveAgent } from '../../core/index.ts'
import type { ProtectedWorkerPaths } from '../../runtime/worker/runtime.ts'
import { isActiveAgent, ownsActiveAgent } from '../agent-cancel.ts'
import { prepareAgentExecutionPaths } from '../agent-execution-inputs.ts'
import { codingSecrets } from '../coding-environment/diagnostics.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import { resolveTeamNativeCodingEnvironment } from '../coding-environment/resolve.ts'
import type { WorkspaceLease } from '../coding-environment/workspace.ts'
import type { DaemonCtx } from '../ctx.ts'
import { ProtectedExecutionUnavailableError } from '../protected-provider.ts'
import { ContextDirectory } from '../repository-context/files.ts'
import { NativeCommandError } from './command.ts'
import {
  assertNativeTurn,
  bindNativeTurnWorker,
  type NativeTurnExecution,
  prepareNativeTurn,
} from './turn.ts'

export interface PrepareAgentNativeInputsOptions {
  readonly lease: WorkspaceLease
  readonly controller: AbortController
  /** Inbox readiness may precede message claiming; its Agent is already fixed. */
  readonly turnId?: string
  readonly includeUploads?: boolean
  /** Trusted caller revalidates installation selection; never a worker/HTTP field. */
  readonly assertSelection?: () => void
}
export interface PreparedAgentNativeInputs {
  readonly paths: ProtectedWorkerPaths
  readonly nativeExecution: NativeExecutionAdmission
  /** Genuine daemon capability, never serialized to a worker. */
  readonly host: NativeTurnExecution
  close(): Promise<boolean>
}
interface Preparation {
  readonly agent: ResolvedAgent
  readonly controller: AbortController
  turnId: string | undefined
  check(): void
}
const preparations = new WeakMap<object, Preparation>()
const unavailable = () =>
  new ProtectedExecutionUnavailableError(
    'Protected native runtime is unavailable. Run `bazilion doctor` for remediation.',
  )
function matches(a: ResolvedAgent, b: ResolvedAgent): boolean {
  return (
    a.agent.id === b.agent.id &&
    a.agent.dir === b.agent.dir &&
    a.team.id === b.team.id &&
    a.team.path === b.team.path &&
    a.model === b.model &&
    a.reasoningLevel === b.reasoningLevel
  )
}
/** Passive defaults become a live admission only under the actual owned workspace/Agent selection. */
export async function prepareAgentNativeInputs(
  ctx: DaemonCtx,
  input: ResolvedAgent,
  inputOptions: PrepareAgentNativeInputsOptions,
): Promise<PreparedAgentNativeInputs> {
  const options = Object.freeze({ ...inputOptions })
  const agent = resolveAgent(ctx.db, ctx.paths, input.agent.id)
  if (!matches(agent, input)) throw unavailable()
  const lifecycle = workspaceLifecycle(ctx.db),
    controller = options.controller
  const selection = resolveTeamNativeCodingEnvironment(ctx.db, agent.team.id)
  const state: Preparation = {
    agent,
    controller,
    turnId: options.turnId,
    check() {
      controller.signal.throwIfAborted()
      options.assertSelection?.()
      lifecycle.coordinator.assertActiveLease(options.lease, agent.team.id, agent.team.path)
      const current = resolveAgent(ctx.db, ctx.paths, agent.agent.id)
      if (
        !matches(agent, current) ||
        current.agent.status === 'archived' ||
        ((state.turnId !== undefined || isActiveAgent(agent.agent.id)) &&
          !ownsActiveAgent(agent.agent.id, controller))
      )
        throw unavailable()
      if (
        JSON.stringify(resolveTeamNativeCodingEnvironment(ctx.db, agent.team.id)) !==
        JSON.stringify(selection)
      )
        throw unavailable()
    },
  }
  state.check()
  const paths = prepareAgentExecutionPaths(ctx.paths, agent, options.includeUploads)
  freezeData(paths)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-')))
  let guard: ContextDirectory | undefined, host: NativeTurnExecution | undefined
  try {
    guard = new ContextDirectory(root)
    host = await prepareNativeTurn({
      root,
      lifecycle,
      lease: options.lease,
      cwd: selection.cwd,
      env: { ...selection.env },
      signal: controller.signal,
      assertActive: () => state.check(),
      secrets: () => [ctx.authToken, ...codingSecrets(mergeSecretsIntoEnv(ctx.db, ctx.authToken))],
      readOnlyDirectories: [
        ...paths.skills.map((skill) => skill.hostDir),
        ...(paths.uploadsDir ? [paths.uploadsDir] : []),
      ],
      readOnlyFiles: [],
      unavailable: [],
      worker: {
        agentId: agent.agent.id,
        ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
      },
    })
    state.check()
    guard.validateIdentity()
    guard.close()
    guard = undefined
    const owned = host
    const prepared = Object.freeze({
      paths,
      nativeExecution: Object.freeze({ cwd: owned.cwd, facts: owned.facts }),
      host: owned,
      close: () => owned.close(),
    })
    preparations.set(prepared, state)
    return prepared
  } catch (error) {
    let confirmed = host
      ? await host.close().catch(() => false)
      : error instanceof NativeCommandError && error.cleanupConfirmed
    try {
      if (!host && confirmed && guard) {
        guard.validateIdentity()
        guard.close()
        guard = undefined
        rmSync(root, { recursive: true })
      }
      guard?.close()
    } catch {
      confirmed = false
    }
    if (!confirmed) options.lease.finish(false)
    throw unavailable()
  }
}
/** The fixed inbox Agent may acquire its canonical message-derived turn identity only once. */
export function bindPreparedNativeInputs(value: PreparedAgentNativeInputs, turnId: string): void {
  const state = preparations.get(value)
  if (
    !state ||
    state.turnId !== undefined ||
    !ownsActiveAgent(state.agent.agent.id, state.controller)
  )
    throw unavailable()
  state.check()
  bindNativeTurnWorker(value.host, { agentId: state.agent.agent.id, turnId })
  state.turnId = turnId
}
export function assertPreparedAgentNativeInputs(
  value: unknown,
  agent: ResolvedAgent,
  turnId: string,
): asserts value is PreparedAgentNativeInputs {
  if (!value || typeof value !== 'object') throw unavailable()
  const state = preparations.get(value)
  if (!state || state.turnId !== turnId || !matches(state.agent, agent)) throw unavailable()
  state.check()
  assertNativeTurn((value as PreparedAgentNativeInputs).host)
}
function freezeData(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeData(child)
  Object.freeze(value)
}
