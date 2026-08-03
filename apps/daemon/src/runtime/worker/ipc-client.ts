import { randomUUID } from 'node:crypto'
import type { IpcReply, IpcRequest, RpcMethod } from './ipc-protocol.ts'

export type WorkerIpcCall = <T>(method: RpcMethod, args: unknown) => Promise<T>

export interface WorkerIpcChannel {
  send?: (message: IpcRequest, done: (error: Error | null) => void) => void
  onMessage(listener: (message: unknown) => void): void
  onDisconnect(listener: () => void): void
}

/**
 * Correlated request client for the worker's private Node IPC channel. A
 * channel disconnect rejects and clears every pending request, so an OAuth
 * refresh cannot pin a worker after its parent or turn has gone away.
 */
export function createIpcClient(channel: WorkerIpcChannel): WorkerIpcCall {
  type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
  const pending = new Map<string, Pending>()
  let disconnected = false

  channel.onMessage((message) => {
    if (!isIpcReply(message)) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) entry.resolve(message.result)
    else entry.reject(new Error(message.error))
  })

  channel.onDisconnect(() => {
    disconnected = true
    for (const entry of pending.values()) {
      entry.reject(new Error('worker IPC channel disconnected'))
    }
    pending.clear()
  })

  return <T>(method: RpcMethod, args: unknown): Promise<T> => {
    if (disconnected) {
      return Promise.reject(new Error('worker IPC channel disconnected'))
    }
    const send = channel.send
    if (!send) {
      return Promise.reject(new Error('worker: no IPC channel — daemon must spawn with stdio:ipc'))
    }
    const id = randomUUID()
    const message = { type: 'rpc', id, method, args } as unknown as IpcRequest
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as T), reject })
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
