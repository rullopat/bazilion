import type { ResolvedAgent } from '@bazilion/api-types'
import type { ProtectedProviderWorkerRuntime } from '../../runtime/worker/runtime.ts'
import { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import type { DaemonCtx } from '../ctx.ts'
import {
  ProtectedExecutionUnavailableError,
  resolveProtectedProviderRuntime,
} from '../protected-provider.ts'
import {
  assertPreparedAgentNativeInputs,
  bindPreparedNativeInputs,
  type PrepareAgentNativeInputsOptions,
  type PreparedAgentNativeInputs,
  prepareAgentNativeInputs,
} from './prepare.ts'

export interface PreparedProtectedNativeExecution extends PreparedAgentNativeInputs {
  readonly backend: 'native'
  readonly docker?: never
  readonly runtime: ProtectedProviderWorkerRuntime
  readonly refreshApiKey: (providerName: string) => Promise<string>
}
const preparations = new WeakMap<
  object,
  { inputs: PreparedAgentNativeInputs; agentId: string; pending: boolean }
>()
/** Nominal classification only; callers must still validate/consume the live Actor-bound turn. */
export function isPreparedProtectedNativeExecution(
  value: unknown,
): value is PreparedProtectedNativeExecution {
  return !!value && typeof value === 'object' && preparations.has(value)
}
const consumed = new WeakSet<object>()
const unavailable = () =>
  new ProtectedExecutionUnavailableError(
    'Protected native execution was not prepared for this Agent turn.',
  )

/** Selected provider credentials stay daemon-owned; native shell inputs never receive them. */
export async function prepareProtectedNativeExecution(
  ctx: DaemonCtx,
  agent: ResolvedAgent,
  options: PrepareAgentNativeInputsOptions,
): Promise<PreparedProtectedNativeExecution> {
  const captured = Object.freeze({ ...options })
  captured.controller.signal.throwIfAborted()
  workspaceLifecycle(ctx.db).coordinator.assertActiveLease(
    captured.lease,
    agent.team.id,
    agent.team.path,
  )
  const provider = await resolveProtectedProviderRuntime(ctx.db, ctx.authToken, agent)
  captured.controller.signal.throwIfAborted()
  freezeRuntime(provider.runtime)
  const inputs = await prepareAgentNativeInputs(ctx, agent, captured)
  try {
    captured.controller.signal.throwIfAborted()
    const prepared = Object.freeze({
      ...inputs,
      backend: 'native' as const,
      runtime: provider.runtime,
      refreshApiKey: provider.refreshApiKey,
    })
    preparations.set(prepared, {
      inputs,
      agentId: agent.agent.id,
      pending: captured.turnId === undefined,
    })
    return prepared
  } catch (error) {
    if (!(await inputs.close().catch(() => false))) captured.lease.finish(false)
    throw error
  }
}
/** Inbox readiness can bind only its already-selected Agent after canonical message claims. */
export function bindPreparedProtectedNativeExecution(
  value: PreparedProtectedNativeExecution,
  turnId: string,
): void {
  const preparation = preparations.get(value)
  if (!preparation?.pending || consumed.has(value)) throw unavailable()
  bindPreparedNativeInputs(preparation.inputs, turnId)
  preparation.pending = false
}
export function assertPreparedProtectedNativeExecution(
  value: unknown,
  agent: ResolvedAgent,
  turnId: string,
): asserts value is PreparedProtectedNativeExecution {
  if (!value || typeof value !== 'object') throw unavailable()
  const preparation = preparations.get(value)
  if (!preparation || preparation.pending) throw unavailable()
  assertPreparedAgentNativeInputs(preparation.inputs, agent, turnId)
  const prepared = value as PreparedProtectedNativeExecution,
    separator = agent.model.indexOf(':')
  if (
    prepared.runtime.providerName !== agent.model.slice(0, separator) ||
    prepared.runtime.modelId !== agent.model.slice(separator + 1) ||
    prepared.runtime.reasoningLevel !== agent.reasoningLevel
  )
    throw unavailable()
}
/** One captured provider/native preparation may enter final turn execution exactly once. */
export function consumePreparedProtectedNativeExecution(
  value: unknown,
  agent: ResolvedAgent,
  turnId: string,
): asserts value is PreparedProtectedNativeExecution {
  if (!isPreparedProtectedNativeExecution(value)) throw unavailable()
  const preparation = preparations.get(value)
  if (!preparation || preparation.agentId !== agent.agent.id || consumed.has(value))
    throw unavailable()
  if (preparation.pending) bindPreparedProtectedNativeExecution(value, turnId)
  assertPreparedProtectedNativeExecution(value, agent, turnId)
  consumed.add(value)
}
function freezeRuntime(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeRuntime(child)
  Object.freeze(value)
}
