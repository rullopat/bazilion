import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { NativeExecutionAdmission, NativeExecutionRequest } from '@bazilion/api-types'
import { codingRelativePath } from '../../core/coding-environment/config.ts'
import type { BashApprovalHost } from '../../runtime/shell/approval.ts'
import { assertNativeExecutionAdmission } from '../../runtime/worker/native-contract.ts'
import type { workspaceLifecycle } from '../coding-environment/lifecycle.ts'
import type { NativeCommandView } from '../coding-environment/resources.ts'
import type { WorkspaceLease } from '../coding-environment/workspace.ts'
import { ContextDirectory } from '../repository-context/files.ts'
import {
  executeNativeCommand,
  NativeCommandError,
  type NativeCommandFailureObservation,
  type NativeCommandResult,
} from './command.ts'
import { prepareNativeDarwinView } from './darwin-view.ts'
import { NativeLayoutError } from './layout.ts'
import { prepareNativeLinuxView } from './linux-view.ts'
import { type NativeRuntime, type NativeRuntimeFacts, prepareNativeRuntime } from './runtime.ts'
import { snapshotNativeViewOptions } from './view-options.ts'

export type NativeTurnRequest = NativeExecutionRequest
export interface NativeTurnOptions {
  readonly root: string
  readonly lifecycle: ReturnType<typeof workspaceLifecycle>
  readonly lease: WorkspaceLease
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly readOnlyDirectories: readonly string[]
  readonly readOnlyFiles: readonly import('./files.ts').NativeFileOptions[]
  readonly unavailable: readonly import('./layout.ts').NativeReadOnlyPath[]
  readonly approvalHost?: BashApprovalHost
  readonly secrets?: () => readonly string[]
  readonly signal?: AbortSignal
  readonly assertActive: () => void
  /** Required only for handing the live turn to one provider worker, never executable authority. */
  readonly worker?: { readonly agentId: string; readonly turnId?: string }
}
export interface NativeTurnExecution {
  readonly facts: NativeRuntimeFacts
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
  exec(
    request: NativeTurnRequest,
    output: (stream: 'stdout' | 'stderr', bytes: Buffer) => void,
    signal?: AbortSignal,
  ): Promise<NativeCommandResult>
  cancel(toolCallId: string): boolean
  close(): Promise<boolean>
}
export interface NativeWorkerBinding {
  readonly agentId: string
  readonly turnId: string
  readonly teamId: string
  readonly registeredRoot: string
  readonly admission: NativeExecutionAdmission
}
const workerBindings = new WeakMap<object, (input: NativeWorkerBinding, consume: boolean) => void>()
const runtimeChecks = new WeakMap<object, () => Promise<void>>()
const deferredWorkers = new WeakMap<object, (agentId: string, turnId: string) => void>()
const workerApprovals = new WeakMap<
  object,
  (binding: NativeWorkerBinding, host: BashApprovalHost) => void
>()
/** Parent-only event/decision channel. A JSON worker description cannot install or replace it. */
export function bindNativeWorkerApproval(
  value: unknown,
  binding: NativeWorkerBinding,
  host: BashApprovalHost,
): void {
  assertBoundNativeTurnForWorker(value, binding)
  if (
    !host ||
    Object.keys(host).join(',') !== 'requestApproval' ||
    typeof host.requestApproval !== 'function'
  )
    throw refusal()
  const bind = workerApprovals.get(value as object)
  if (!bind) throw refusal()
  bind(binding, host)
}
const failureObservations = new WeakMap<object, NativeCommandFailureObservation>()
/** Read-only last retained failure facts. Stopped admissions remain diagnosable, never executable. */
export function nativeTurnFailureObservation(
  value: unknown,
): NativeCommandFailureObservation | undefined {
  if (!value || typeof value !== 'object' || !admitted.has(value)) throw refusal()
  return failureObservations.get(value)
}
const admitted = new WeakSet<object>(),
  stopped = new WeakSet<object>()
const refusal = () => new NativeLayoutError('unavailable')
export function assertNativeTurn(value: unknown): asserts value is NativeTurnExecution {
  if (!value || typeof value !== 'object' || !admitted.has(value) || stopped.has(value))
    throw refusal()
}
/** One live, actor/turn/Team-bound handoff; JSON descriptions and copied proxies cannot bind. */
export function consumeNativeTurnForWorker(
  value: unknown,
  input: NativeWorkerBinding,
): asserts value is NativeTurnExecution {
  assertNativeTurn(value)
  const bind = workerBindings.get(value)
  if (!bind) throw refusal()
  bind(input, true)
}
/** Inbox readiness precedes message claims: fix its already-selected Agent's turn exactly once. */
export function bindNativeTurnWorker(
  value: unknown,
  worker: { readonly agentId: string; readonly turnId: string },
): void {
  assertNativeTurn(value)
  if (
    !worker ||
    Object.keys(worker).sort().join(',') !== 'agentId,turnId' ||
    ![worker.agentId, worker.turnId].every(validWorkerId)
  )
    throw refusal()
  const bind = deferredWorkers.get(value)
  if (!bind) throw refusal()
  bind(worker.agentId, worker.turnId)
}
function validWorkerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    Array.from(value).every((char) => char.charCodeAt(0) >= 32)
  )
}
/** Recheck the same bound live admission immediately before releasing worker input. */
export function assertBoundNativeTurnForWorker(value: unknown, input: NativeWorkerBinding): void {
  assertNativeTurn(value)
  const bind = workerBindings.get(value)
  if (!bind) throw refusal()
  bind(input, false)
}
/** Passive bounded FD/runtime revalidation for freezing evidence; no command or provider request. */
export async function revalidateBoundNativeTurnForWorker(
  value: unknown,
  input: NativeWorkerBinding,
): Promise<void> {
  assertBoundNativeTurnForWorker(value, input)
  const check = runtimeChecks.get(value as object)
  if (!check) throw refusal()
  await check()
  assertBoundNativeTurnForWorker(value, input)
}
function request(value: NativeTurnRequest): NativeTurnRequest {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 4 ||
    !['toolCallId', 'command', 'cwd', 'timeoutMs'].every((key) => Object.hasOwn(value, key)) ||
    typeof value.toolCallId !== 'string' ||
    !value.toolCallId ||
    value.toolCallId.length > 256 ||
    typeof value.command !== 'string' ||
    !value.command.trim() ||
    Buffer.byteLength(value.command) > 256 * 1024 ||
    value.command.includes('\0') ||
    Buffer.from(value.command, 'utf8').toString('utf8') !== value.command ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > 300_000
  )
    throw refusal()
  return Object.freeze({ ...value, cwd: codingRelativePath(value.cwd) })
}
/** Bounded synthetic deny proof. Its paths/data are private sentinels, never personal files. */
async function proveBoundary(
  view: NativeCommandView,
  options: Pick<NativeTurnOptions, 'lifecycle' | 'lease'>,
  node: string,
  readonlyFile: string,
  outside: string,
  signal: AbortSignal,
) {
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.end()
  })
  let handed = false
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        server.close()
        reject(new NativeCommandError('cancelled', true))
      }
      signal.addEventListener('abort', abort, { once: true })
      server.once('error', (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      })
      server.listen({ host: '127.0.0.1', port: 0 }, () => {
        signal.removeEventListener('abort', abort)
        resolve()
      })
    })
    signal.throwIfAborted()
    const address = server.address()
    if (!address || typeof address === 'string') throw refusal()
    const token = randomUUID(),
      toolCallId = `native-readiness-${token}`
    const nodeArgument = `'${node.replaceAll("'", "'\\''")}'`
    const command = `${nodeArgument} --input-type=module - <<'BAZILION_NATIVE_PROBE'
import fs from 'node:fs'
import net from 'node:net'
import dgram from 'node:dgram'
import path from 'node:path'
const blocked=error=>['EPERM','EACCES','EROFS','ENOENT'].includes(error.code)
const proof={token:${JSON.stringify(token)},read:false,readonly:false,outside:false,tcp:false,udp:false,ipc:false,scratch:false}
proof.read=fs.readFileSync(${JSON.stringify(readonlyFile)},'utf8')==='readonly-native-canary'
try{fs.writeFileSync(${JSON.stringify(readonlyFile)},'forbidden')}catch(error){proof.readonly=blocked(error)}
try{fs.readFileSync(${JSON.stringify(outside)})}catch(error){proof.outside=blocked(error)}
await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:${address.port}});socket.once('error',error=>{proof.tcp=['EPERM','EACCES'].includes(error.code);resolve()});socket.once('connect',()=>{socket.end();resolve()})})
await new Promise(resolve=>{const socket=dgram.createSocket('udp4');socket.once('error',error=>{proof.udp=['EPERM','EACCES'].includes(error.code);try{socket.close()}catch{}resolve()});socket.bind(0,'127.0.0.1',()=>{socket.close();resolve()})})
const local=path.join(process.env.TMPDIR,'probe.sock'),server=net.createServer(socket=>socket.end('private-native-ipc'))
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(local,resolve)})
let answer=''
await new Promise((resolve,reject)=>{const client=net.connect(local);client.once('error',reject);client.on('data',bytes=>answer+=bytes.toString());client.once('end',resolve)})
await new Promise(resolve=>server.close(resolve));proof.ipc=answer==='private-native-ipc'
const temporary=path.join(process.env.TMPDIR,'probe-file');fs.writeFileSync(temporary,'private-scratch',{flag:'wx'});proof.scratch=fs.readFileSync(temporary,'utf8')==='private-scratch';fs.unlinkSync(temporary)
console.log(JSON.stringify(proof))
BAZILION_NATIVE_PROBE
`
    let stdout = ''
    handed = true
    const result = await executeNativeCommand({
      view,
      lifecycle: options.lifecycle,
      lease: options.lease,
      command,
      toolCallId,
      timeoutMs: 5000,
      signal,
      approvalHost: {
        async requestApproval(value) {
          return value.command === command && value.toolCallId === toolCallId
            ? 'approved'
            : 'denied'
        },
      },
      onOutput(stream, bytes) {
        if (stream === 'stdout') {
          stdout += bytes.toString()
          if (stdout.length > 4096) throw refusal()
        }
      },
    })
    if (
      result.code !== 0 ||
      result.signal ||
      result.stdoutTruncated ||
      result.stderrTruncated ||
      connections
    )
      throw refusal()
    const proof = JSON.parse(stdout)
    if (
      proof.token !== token ||
      !['read', 'readonly', 'outside', 'tcp', 'udp', 'ipc', 'scratch'].every(
        (key) => proof[key] === true,
      )
    )
      throw refusal()
  } finally {
    if (!handed) view.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** One daemon-bound turn: real readiness before admission, frozen runtime, serial one-use effects. */
export async function prepareNativeTurn(input: NativeTurnOptions): Promise<NativeTurnExecution> {
  const snapshot = snapshotNativeViewOptions({ ...input, workspace: input.lease.writer.root })
  const worker = input.worker === undefined ? undefined : Object.freeze({ ...input.worker })
  if (
    worker &&
    (!['agentId', 'agentId,turnId'].includes(Object.keys(worker).sort().join(',')) ||
      !validWorkerId(worker.agentId) ||
      (Object.hasOwn(worker, 'turnId') && !validWorkerId(worker.turnId)))
  )
    throw refusal()
  let workerConsumed = false,
    workerTurnId = worker?.turnId,
    workerApprovalHost: BashApprovalHost | undefined
  const lifecycle = input.lifecycle,
    lease = input.lease,
    assertActive = input.assertActive,
    approvalHost = input.approvalHost,
    secrets = input.secrets
  const stop = new AbortController(),
    signal = AbortSignal.any([...(input.signal ? [input.signal] : []), stop.signal])
  let root: ContextDirectory | undefined,
    runtime: NativeRuntime | undefined,
    blocked = false,
    disabled = false,
    tail = Promise.resolve(),
    next = 0,
    closed = false,
    closing: Promise<boolean> | undefined
  const calls = new Set<string>()
  const cancellations = new Map<string, AbortController>()
  try {
    assertActive()
    signal.throwIfAborted()
    lifecycle.coordinator.assertActiveLease(lease, lease.writer.teamId, snapshot.workspace)
    const info = lstatSync(snapshot.root)
    if (
      realpathSync(snapshot.root) !== snapshot.root ||
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      readdirSync(snapshot.root).length
    )
      throw refusal()
    root = new ContextDirectory(snapshot.root)
    const runtimeRoot = join(snapshot.root, 'runtime'),
      jobs = join(snapshot.root, 'jobs'),
      readonly = join(snapshot.root, 'readonly'),
      outside = join(snapshot.root, 'unavailable-canary')
    for (const path of [runtimeRoot, jobs, readonly]) mkdirSync(path, { mode: 0o700 })
    const readonlyFile = join(readonly, 'canary')
    writeFileSync(readonlyFile, 'readonly-native-canary', { mode: 0o600, flag: 'wx' })
    writeFileSync(outside, 'outside-native-canary', { mode: 0o600, flag: 'wx' })
    runtime = await prepareNativeRuntime(runtimeRoot, signal)
    const heldRuntime = runtime,
      heldRoot = root
    async function view(
      cwd: string,
      probe = false,
      jobSignal = signal,
    ): Promise<NativeCommandView> {
      assertActive()
      jobSignal.throwIfAborted()
      lifecycle.coordinator.assertActiveLease(lease, lease.writer.teamId, snapshot.workspace)
      const slot = join(jobs, `command-${++next}`)
      mkdirSync(slot, { mode: 0o700 })
      const options = {
        ...snapshot,
        root: slot,
        cwd,
        signal: jobSignal,
        readOnlyDirectories: [...snapshot.readOnlyDirectories, ...(probe ? [readonly] : [])],
        unavailable: [...snapshot.unavailable, { path: outside, kind: 'file' as const }],
      }
      return heldRuntime.facts.backend === 'linux-bwrap'
        ? prepareNativeLinuxView(options, heldRuntime)
        : prepareNativeDarwinView(options, heldRuntime)
    }
    const probe = await view(snapshot.cwd, true)
    try {
      await proveBoundary(
        probe,
        { lifecycle, lease },
        heldRuntime.node,
        readonlyFile,
        outside,
        signal,
      )
    } catch (error) {
      if (error instanceof NativeCommandError && !error.cleanupConfirmed) blocked = true
      throw error
    }
    assertActive()
    signal.throwIfAborted()
    const result: NativeTurnExecution = Object.freeze({
      facts: runtime.facts,
      env: snapshot.env,
      cwd: snapshot.cwd,
      exec(
        raw: NativeTurnRequest,
        output: (stream: 'stdout' | 'stderr', bytes: Buffer) => void,
        toolSignal?: AbortSignal,
      ) {
        assertNativeTurn(result)
        if (worker && !workerConsumed) throw refusal()
        const captured = request(raw)
        if (calls.has(captured.toolCallId) || calls.size >= 128) throw refusal()
        calls.add(captured.toolCallId)
        const cancellation = new AbortController()
        cancellations.set(captured.toolCallId, cancellation)
        const combined = AbortSignal.any([
          signal,
          cancellation.signal,
          ...(toolSignal ? [toolSignal] : []),
        ])
        const operation = tail.then(async () => {
          assertNativeTurn(result)
          assertActive()
          if (combined.aborted) throw new NativeCommandError('cancelled', true)
          if (secrets?.().some((value) => value && captured.command.includes(value)))
            throw new NativeCommandError('unavailable', true)
          if (blocked) throw new NativeCommandError('recovery_required', false)
          if (disabled) throw new NativeCommandError('unavailable', true)
          let prepared: NativeCommandView
          try {
            prepared = await view(captured.cwd, false, combined)
          } catch (error) {
            if (combined.aborted) throw new NativeCommandError('cancelled', true)
            disabled = true
            throw error
          }
          try {
            return await executeNativeCommand({
              view: prepared,
              lifecycle,
              lease,
              command: captured.command,
              toolCallId: captured.toolCallId,
              timeoutMs: captured.timeoutMs,
              signal: combined,
              approvalHost: approvalHost ?? workerApprovalHost,
              onOutput: output,
            })
          } catch (error) {
            if (error instanceof NativeCommandError && !error.cleanupConfirmed) {
              blocked = true
              if (error.observation) failureObservations.set(result, error.observation)
            }
            throw error
          }
        })
        void operation.finally(() => cancellations.delete(captured.toolCallId)).catch(() => {})
        tail = operation.then(
          () => {},
          () => {},
        )
        return operation
      },
      cancel(toolCallId: string) {
        assertNativeTurn(result)
        if (typeof toolCallId !== 'string' || !toolCallId || toolCallId.length > 256)
          throw refusal()
        const cancellation = cancellations.get(toolCallId)
        if (!cancellation) return false
        cancellation.abort()
        return true
      },
      close() {
        if (closed) return Promise.resolve(true)
        if (closing) return closing
        const operation = (async () => {
          stopped.add(result)
          stop.abort()
          await tail
          // A retained command view holds a runtime loan until canonical live-owner cleanup has
          // positively released it. A later close may retire the template only after ALL such
          // loans disappear; it never resends signals, reruns code or reopens this admission.
          if (!heldRuntime.close()) return false
          heldRoot.validateIdentity()
          heldRoot.close()
          try {
            rmSync(snapshot.root, { recursive: true })
            closed = true
            return true
          } catch {
            return false
          }
        })()
        closing = operation
        void operation.then(
          (confirmed) => {
            if (!confirmed && closing === operation) closing = undefined
          },
          () => {
            if (closing === operation) closing = undefined
          },
        )
        return operation
      },
    })
    admitted.add(result)
    if (worker && workerTurnId === undefined)
      deferredWorkers.set(result, (agentId, turnId) => {
        assertNativeTurn(result)
        assertActive()
        signal.throwIfAborted()
        lifecycle.coordinator.assertActiveLease(lease, lease.writer.teamId, snapshot.workspace)
        if (workerConsumed || workerTurnId !== undefined || worker.agentId !== agentId)
          throw refusal()
        workerTurnId = turnId
      })
    if (worker && !approvalHost)
      workerApprovals.set(result, (binding, host) => {
        assertBoundNativeTurnForWorker(result, binding)
        if (workerApprovalHost) throw refusal()
        const requestApproval = host.requestApproval
        workerApprovalHost = Object.freeze({
          requestApproval: (request: Parameters<BashApprovalHost['requestApproval']>[0]) =>
            requestApproval.call(host, request),
        })
      })
    workerBindings.set(result, (binding, consume) => {
      assertNativeTurn(result)
      assertNativeExecutionAdmission(binding.admission)
      assertActive()
      signal.throwIfAborted()
      lifecycle.coordinator.assertActiveLease(lease, binding.teamId, binding.registeredRoot)
      if (
        (consume ? workerConsumed : !workerConsumed) ||
        blocked ||
        disabled ||
        !worker ||
        binding.agentId !== worker.agentId ||
        binding.turnId !== workerTurnId ||
        binding.admission.cwd !== result.cwd ||
        !(
          [
            'backend',
            'architecture',
            'nodeVersion',
            'kernelRelease',
            'policyFingerprint',
            'fingerprint',
          ] as const
        ).every((key) => binding.admission.facts[key] === result.facts[key])
      )
        throw refusal()
      if (consume) workerConsumed = true
    })
    runtimeChecks.set(result, () => heldRuntime.revalidate())
    return result
  } catch (error) {
    const cancelled = signal.aborted
    stop.abort()
    let settled = true
    try {
      settled = runtime?.close() ?? true
    } catch {
      settled = false
    }
    if (settled && !blocked) {
      try {
        root?.close()
      } catch {
        settled = false
      }
    }
    const cleanupConfirmed = settled && !blocked
    // Only closed facts cross this boundary; no raw path/native cause grants deletion authority.
    throw new NativeCommandError(
      !cleanupConfirmed ? 'recovery_required' : cancelled ? 'cancelled' : 'unavailable',
      cleanupConfirmed,
      error instanceof NativeCommandError ? error.observation : undefined,
    )
  }
}
