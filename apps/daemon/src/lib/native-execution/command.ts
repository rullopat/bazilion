import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import type { NativeExecutionFailureObservation, NativeExecutionResult } from '@bazilion/api-types'
import { snapshotNativeFailureObservation } from '../../core/coding-environment/native-failure.ts'
import { type BashApprovalHost, requireBashApproval } from '../../runtime/shell/approval.ts'
import type { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import type { NativeCommandOwner, NativeCommandView } from '../coding-environment/resources.ts'
import type { WorkspaceLease } from '../coding-environment/workspace.ts'
import { OwnedDarwinJob } from '../process/darwin-domain.ts'
import { OwnedLinuxNamespace } from '../process/linux-domain.ts'
import { assertNativeDarwinView } from './darwin-view.ts'
import { assertNativeLinuxView } from './linux-view.ts'

const executions = new WeakSet<object>()

export interface NativeCommandFailureObservation {
  readonly backend: 'darwin-seatbelt'
  readonly domain: ReturnType<OwnedDarwinJob['observation']>
}
export class NativeCommandError extends Error {
  readonly observation: NativeCommandFailureObservation | undefined
  constructor(
    readonly code: 'unavailable' | 'cancelled' | 'timed_out' | 'recovery_required',
    readonly cleanupConfirmed: boolean,
    observation?: NativeCommandFailureObservation,
  ) {
    super(
      code === 'recovery_required'
        ? 'Native command cleanup is unconfirmed; workspace recovery required'
        : `Native command ${code}`,
    )
    this.name = 'NativeCommandError'
    this.observation = observation
  }
}
/** Strip native implementation diagnostics to the closed wire vocabulary; never expose PIDs/paths. */
export function nativeCommandFailureObservation(
  error: NativeCommandError,
): NativeExecutionFailureObservation | undefined {
  const observation = error.observation
  if (!observation || error.cleanupConfirmed || error.code !== 'recovery_required') return undefined
  const domain = observation.domain
  try {
    return snapshotNativeFailureObservation({
      backend: observation.backend,
      phase: domain.phase,
      ownerLive: domain.ownerLive,
      commandCompleted: domain.commandCompleted,
      commandNaturalEOF: domain.commandNaturalEOF,
      fenced: domain.fenced,
      terminalProof: domain.terminalProof,
      captures: domain.captures.map((capture) =>
        capture.kind === 'observation' && ['empty_at_capture', 'busy'].includes(capture.state ?? '')
          ? capture.state
          : ['drift', 'first_drift', 'last_drift', 'scoped_drift'].includes(capture.reason ?? '')
            ? 'drift'
            : 'unknown',
      ),
    })
  } catch {
    return undefined
  }
}
export type NativeCommandResult = NativeExecutionResult
export interface NativeCommandOptions {
  readonly view: NativeCommandView
  readonly lifecycle: ReturnType<typeof workspaceLifecycle>
  readonly lease: WorkspaceLease
  readonly command: string
  readonly toolCallId: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly approvalHost?: BashApprovalHost
  /** Trusted caller owns live redaction, retained output and source-owned disclosure. */
  readonly onOutput: (stream: 'stdout' | 'stderr', bytes: Buffer) => void
}

/**
 * Shared one-shot kernel executor for bash/coding/helpers/captured checks. Only nominal daemon
 * views enter; no backend/profile/root/credential override crosses the worker boundary. The
 * enclosing turn admission must pin the runtime and serialize commands; this is not turn admission.
 */
export async function executeNativeCommand(
  options: NativeCommandOptions,
): Promise<NativeCommandResult> {
  const { view, command, toolCallId, signal } = options
  if (view.backend === 'linux-bwrap') assertNativeLinuxView(view)
  else assertNativeDarwinView(view)
  if (executions.has(view)) throw new NativeCommandError('unavailable', false)
  executions.add(view)
  try {
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      Buffer.byteLength(command) > 256 * 1024 ||
      command.includes('\0') ||
      Buffer.from(command, 'utf8').toString('utf8') !== command ||
      typeof toolCallId !== 'string' ||
      !toolCallId ||
      Buffer.byteLength(toolCallId) > 256 ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 300_000
    )
      throw new NativeCommandError('unavailable', true)
    signal?.throwIfAborted()
    await requireBashApproval(command, toolCallId, signal, options.approvalHost)
    signal?.throwIfAborted()
  } catch (error) {
    view.close()
    if (signal?.aborted) throw new NativeCommandError('cancelled', true)
    throw error
  }
  const timeout = new AbortController(),
    outputFailure = new AbortController()
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs)
  timer.unref()
  const combined = AbortSignal.any([
    ...(signal ? [signal] : []),
    timeout.signal,
    outputFailure.signal,
  ])
  let binding: ReturnType<typeof options.lifecycle.native> | undefined,
    owner: NativeCommandOwner | undefined,
    attempted = false,
    released = false,
    active = true,
    acknowledged = false,
    retained = 0,
    stdoutTruncated = false,
    stderrTruncated = false
  const nonce = randomUUID(),
    marker = Buffer.from(`BAZILION_NATIVE_READY:${nonce}\n`)
  let prefix = Buffer.alloc(0),
    markerSeen = false,
    prefixInvalid = false
  let failure: unknown,
    failed = false,
    cleanupConfirmed = false,
    outputFailed = false,
    result: NativeCommandResult | undefined
  const output = (stream: 'stdout' | 'stderr', bytes: Buffer) => {
    if (!active || !released) return
    const selected = bytes.subarray(0, Math.max(0, 2 * 1024 * 1024 - retained))
    retained += selected.length
    if (selected.length !== bytes.length) {
      if (stream === 'stdout') stdoutTruncated = true
      else stderrTruncated = true
    }
    if (selected.length) {
      try {
        options.onOutput(stream, Buffer.from(selected))
      } catch {
        outputFailed = true
        outputFailure.abort()
      }
    }
  }
  const abort = () => {
    if (acknowledged) void owner?.terminate().catch(() => {})
  }
  combined.addEventListener('abort', abort, { once: true })
  try {
    combined.throwIfAborted()
    await view.revalidate()
    binding = options.lifecycle.native(options.lease, view.backend, view.definition, view)
    const args = view.arguments(nonce)
    combined.throwIfAborted()
    binding.beforeSpawn()
    attempted = true
    const child = spawn(view.manager.requestedPath, args, {
      cwd: view.cwd,
      env: { ...view.env },
      detached: true,
      stdio: [...view.stdio],
    })
    const terminal = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => child.once('close', (code, signal) => resolve({ code, signal })),
    )
    child.once('error', () => {}) // Owner/close evidence handles launch failure; never an unhandled event.
    if (view.backend === 'linux-bwrap') {
      if (!child.stdout || !child.stderr) throw new Error('native pipes unavailable')
      child.stdout.on('data', (bytes: Buffer) => {
        if (prefixInvalid) return
        if (!markerSeen) {
          prefix = Buffer.concat([prefix, bytes])
          if (prefix.length < marker.length) return
          if (!prefix.subarray(0, marker.length).equals(marker)) {
            prefixInvalid = true
            prefix = Buffer.alloc(0)
            return
          }
          markerSeen = true
          output('stdout', prefix.subarray(marker.length))
          prefix = Buffer.alloc(0)
        } else output('stdout', bytes)
      })
      child.stderr.on('data', (bytes: Buffer) => output('stderr', bytes))
      owner = new OwnedLinuxNamespace(child, nonce)
    } else owner = new OwnedDarwinJob(child, nonce, output)
    binding.bind(owner)
    if (view.backend === 'linux-bwrap') {
      const channels: readonly unknown[] = child.stdio,
        gate = channels[5]
      if (!(gate instanceof Writable)) throw new Error('native startup gate unavailable')
      gate.end()
    }
    await binding.afterCreation()
    acknowledged = true
    await view.revalidate()
    combined.throwIfAborted()
    let rejectAbort: (error: Error) => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const abortWait = () =>
      rejectAbort(new NativeCommandError(timeout.signal.aborted ? 'timed_out' : 'cancelled', false))
    combined.addEventListener('abort', abortWait, { once: true })
    try {
      combined.throwIfAborted()
      released = true
      const admittedOwner = owner
      if (admittedOwner instanceof OwnedLinuxNamespace) {
        const execution = (async () => {
          await admittedOwner.execute(command)
          return terminal
        })()
        const completed = await Promise.race([execution, cancelled])
        result = { ...completed, stdoutTruncated, stderrTruncated }
      } else {
        const completed = await Promise.race([admittedOwner.execute(command), cancelled])
        result = {
          code: completed.code,
          signal: completed.signal as NodeJS.Signals | null,
          stdoutTruncated: stdoutTruncated || completed.stdoutTruncated,
          stderrTruncated: stderrTruncated || completed.stderrTruncated,
        }
      }
    } finally {
      combined.removeEventListener('abort', abortWait)
    }
  } catch (error) {
    failed = true
    failure = error
  } finally {
    active = false
    clearTimeout(timer)
    combined.removeEventListener('abort', abort)
    let settled = false
    try {
      if (binding) {
        if (attempted) settled = await binding.afterExit()
        else {
          binding.cancelBeforeSpawn()
          settled = true
        }
      } else if (!attempted) {
        view.close()
        settled = true
      }
    } catch {
      settled = false
    }
    cleanupConfirmed = settled
  }
  if (!cleanupConfirmed) {
    let observation: NativeCommandFailureObservation | undefined
    try {
      if (owner instanceof OwnedDarwinJob)
        observation = Object.freeze({ backend: 'darwin-seatbelt', domain: owner.observation() })
    } catch {
      /* Diagnostics never replace uncertain ownership. */
    }
    throw new NativeCommandError('recovery_required', false, observation)
  }
  if (outputFailed) throw new NativeCommandError('unavailable', true)
  if (failed) {
    if (failure instanceof NativeCommandError) throw new NativeCommandError(failure.code, true)
    throw new NativeCommandError(
      combined.aborted ? (timeout.signal.aborted ? 'timed_out' : 'cancelled') : 'unavailable',
      true,
    )
  }
  if (!result) throw new NativeCommandError('unavailable', true)
  return Object.freeze(result)
}
