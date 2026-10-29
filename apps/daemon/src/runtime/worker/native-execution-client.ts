import type { NativeExecutionRequest, NativeExecutionResult } from '@bazilion/api-types'
import type { WorkerIpcCall } from './ipc-client.ts'
import type { NativeExecutionHost } from './ipc-protocol.ts'

function result(value: unknown): asserts value is NativeExecutionResult {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'code,signal,stderrTruncated,stdoutTruncated'
  )
    throw new Error('Invalid native execution reply')
  const item = value as Record<string, unknown>
  if (
    (item.code !== null &&
      (!Number.isInteger(item.code) || Number(item.code) < 0 || Number(item.code) > 255)) ||
    (item.signal !== null &&
      (typeof item.signal !== 'string' ||
        !/^SIG[A-Z0-9]+$/.test(item.signal) ||
        item.signal.length > 32)) ||
    typeof item.stdoutTruncated !== 'boolean' ||
    typeof item.stderrTruncated !== 'boolean'
  )
    throw new Error('Invalid native execution reply')
}
/** Worker-side proxy only. No native launcher, host filesystem operations or backend selection. */
export function createIpcNativeExecutionHost(call: WorkerIpcCall): NativeExecutionHost {
  return {
    cancel() {
      throw new Error('worker native cancellation must stay correlated with its invocation')
    },
    async exec(input: NativeExecutionRequest, output, signal) {
      const request = Object.freeze({ ...input })
      signal?.throwIfAborted()
      const cancel = () => {
        void call('nativeCancel', { toolCallId: request.toolCallId }).catch(() => {})
      }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        signal?.throwIfAborted()
        const value = await call<unknown>('nativeExecute', request, {
          onNativeOutput(part) {
            try {
              output(part.stream, Buffer.from(part.data, 'base64'), {
                observedBytes: part.observedBytes,
                redacted: part.redacted,
              })
            } catch (error) {
              cancel()
              throw error
            }
          },
        })
        result(value)
        return value
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
  }
}
