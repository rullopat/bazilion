import { randomUUID } from 'node:crypto'
import type {
  NativeExecutionFailure,
  NativeExecutionFailureObservation,
  NativeExecutionOutput,
} from '@bazilion/api-types'
import { snapshotNativeFailureObservation } from '../../core/coding-environment/native-failure.ts'
import type { IpcReply, IpcRequest, RpcMethod } from './ipc-protocol.ts'

export interface WorkerIpcCallOptions {
  onNativeOutput?: (output: NativeExecutionOutput) => void
}
export type WorkerIpcCall = <T>(
  method: RpcMethod,
  args: unknown,
  options?: WorkerIpcCallOptions,
) => Promise<T>

export interface WorkerIpcChannel {
  send?: (message: IpcRequest, done: (error: Error | null) => void) => void
  onMessage(listener: (message: unknown) => void): void
  onDisconnect(listener: () => void): void
}
export class WorkerNativeExecutionError extends Error {
  readonly code: NativeExecutionFailure['code']
  readonly cleanupConfirmed: boolean
  readonly observation: NativeExecutionFailureObservation | undefined
  constructor(message: string, failure: NativeExecutionFailure) {
    super(message)
    this.name = 'WorkerNativeExecutionError'
    this.code = failure.code
    this.cleanupConfirmed = failure.cleanupConfirmed
    this.observation = failure.observation
      ? snapshotNativeFailureObservation(failure.observation)
      : undefined
  }
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
function nativeFailure(value: unknown): value is NativeExecutionFailure {
  if (plain(value) && Object.hasOwn(value, 'observation')) {
    if (value.cleanupConfirmed !== false || value.code !== 'recovery_required') return false
    try {
      snapshotNativeFailureObservation(value.observation)
    } catch {
      return false
    }
  }
  return (
    plain(value) &&
    ['cleanupConfirmed,code', 'cleanupConfirmed,code,observation'].includes(
      Object.keys(value).sort().join(','),
    ) &&
    typeof value.code === 'string' &&
    ['unavailable', 'approval_denied', 'cancelled', 'timed_out', 'recovery_required'].includes(
      value.code,
    ) &&
    typeof value.cleanupConfirmed === 'boolean'
  )
}

/** Correlated private IPC; bounded native output remains attached to its original pending call. */
export function createIpcClient(channel: WorkerIpcChannel): WorkerIpcCall {
  type Pending = {
    method: RpcMethod
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    output?: WorkerIpcCallOptions['onNativeOutput']
    sequence: number
    bytes: number
    observedBytes: number
    redacted: boolean
    outputError?: Error
  }
  const pending = new Map<string, Pending>()
  let disconnected = false
  channel.onMessage((message) => {
    if (plain(message) && message.type === 'rpc-output' && typeof message.id === 'string') {
      const entry = pending.get(message.id)
      if (!entry || entry.outputError) return
      try {
        if (
          entry.method !== 'nativeExecute' ||
          Object.keys(message).sort().join(',') !==
            'data,id,observedBytes,redacted,sequence,stream,type' ||
          !['stdout', 'stderr'].includes(String(message.stream)) ||
          message.sequence !== entry.sequence + 1 ||
          entry.sequence >= 4096 ||
          typeof message.observedBytes !== 'number' ||
          !Number.isSafeInteger(message.observedBytes) ||
          message.observedBytes < 1 ||
          message.observedBytes < entry.observedBytes ||
          message.observedBytes > 2 * 1024 * 1024 ||
          typeof message.redacted !== 'boolean' ||
          (entry.redacted && !message.redacted) ||
          typeof message.data !== 'string' ||
          !message.data.length ||
          message.data.length > 87_384
        )
          throw new Error('Invalid native IPC output')
        const bytes = Buffer.from(message.data, 'base64')
        if (
          bytes.length > 64 * 1024 ||
          bytes.toString('base64') !== message.data ||
          entry.bytes + bytes.length > 2 * 1024 * 1024
        )
          throw new Error('Invalid native IPC output')
        entry.sequence++
        entry.bytes += bytes.length
        entry.observedBytes = message.observedBytes
        entry.redacted = message.redacted
        entry.output?.({
          stream: message.stream as 'stdout' | 'stderr',
          sequence: entry.sequence,
          data: message.data,
          observedBytes: entry.observedBytes,
          redacted: entry.redacted,
        })
      } catch (error) {
        // Do not finish the tool early while its effect may still be running. Await the parent's
        // terminal reply/cleanup; an output callback cannot authorize workspace release or replay.
        entry.outputError =
          error instanceof Error ? error : new Error('Native IPC output unavailable')
      }
      return
    }
    if (!isIpcReply(message)) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) {
      if (entry.outputError) entry.reject(entry.outputError)
      else entry.resolve(message.result)
    } else if (
      (entry.method === 'nativeExecute' || entry.method === 'nativeCancel') &&
      message.nativeFailure !== undefined
    ) {
      if (nativeFailure(message.nativeFailure))
        entry.reject(new WorkerNativeExecutionError(message.error, message.nativeFailure))
      else entry.reject(new Error('Invalid native IPC failure'))
    } else entry.reject(new Error(message.error))
  })
  channel.onDisconnect(() => {
    disconnected = true
    for (const entry of pending.values()) entry.reject(new Error('worker IPC channel disconnected'))
    pending.clear()
  })
  return <T>(method: RpcMethod, args: unknown, options?: WorkerIpcCallOptions): Promise<T> => {
    if (disconnected) return Promise.reject(new Error('worker IPC channel disconnected'))
    const send = channel.send
    if (!send)
      return Promise.reject(new Error('worker: no IPC channel — daemon must spawn with stdio:ipc'))
    if (options?.onNativeOutput && method !== 'nativeExecute')
      return Promise.reject(new Error('Native IPC output requires native execution'))
    const id = randomUUID(),
      message = { type: 'rpc', id, method, args } as unknown as IpcRequest
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        output: options?.onNativeOutput,
        sequence: 0,
        bytes: 0,
        observedBytes: 0,
        redacted: false,
      })
      try {
        send(message, (error) => {
          if (!error) return
          pending.delete(id)
          reject(error)
        })
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
function isIpcReply(message: unknown): message is IpcReply {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Record<string, unknown>
  return (
    candidate.type === 'rpc-reply' &&
    typeof candidate.id === 'string' &&
    typeof candidate.ok === 'boolean'
  )
}
