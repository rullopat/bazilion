import { StringDecoder } from 'node:string_decoder'
import type {
  NativeExecutionOutput,
  NativeExecutionRequest,
  NativeExecutionResult,
} from '@bazilion/api-types'
import { NativeCommandError } from '../../lib/native-execution/command.ts'
import type { NativeExecutionHost } from './ipc-protocol.ts'
import { ExactValueStreamRedactor } from './runtime.ts'

export interface NativeRpcOutputContext {
  assertActive(): void
  secrets(): readonly string[]
  signal?: AbortSignal
  send(output: NativeExecutionOutput): Promise<void>
}
/** Codec only, not admission. Caller must bind/assert the actual prepared turn host. */
export async function dispatchNativeExecution(
  request: NativeExecutionRequest,
  host: NativeExecutionHost,
  context: NativeRpcOutputContext,
): Promise<NativeExecutionResult> {
  context.assertActive()
  context.signal?.throwIfAborted()
  if (
    typeof request?.command === 'string' &&
    context.secrets().some((value) => value && request.command.includes(value))
  )
    throw new NativeCommandError('unavailable', true)
  const abort = new AbortController(),
    signal = AbortSignal.any([...(context.signal ? [context.signal] : []), abort.signal])
  const streams = {
    stdout: { decoder: new StringDecoder('utf8'), redactor: new ExactValueStreamRedactor([]) },
    stderr: { decoder: new StringDecoder('utf8'), redactor: new ExactValueStreamRedactor([]) },
  }
  const sends: Promise<void>[] = []
  let sequence = 0,
    rawBytes = 0,
    wireBytes = 0,
    transportFailed = false,
    stdoutTruncated = false,
    stderrTruncated = false
  const update = () => {
    for (const value of context.secrets())
      if (value) for (const stream of Object.values(streams)) stream.redactor.add(value)
  }
  const emit = (stream: 'stdout' | 'stderr', text: string) => {
    if (!text || transportFailed) return
    context.assertActive()
    signal.throwIfAborted()
    const bytes = Buffer.from(text)
    let end = Math.min(bytes.length, Math.max(0, 2 * 1024 * 1024 - wireBytes))
    while (end > 0 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
    if (end < bytes.length) {
      if (stream === 'stdout') stdoutTruncated = true
      else stderrTruncated = true
    }
    for (let offset = 0; offset < end; ) {
      let selected = Math.min(end, offset + 64 * 1024)
      while (selected < end && ((bytes[selected] ?? 0) & 0xc0) === 0x80) selected--
      if (++sequence > 4096) throw new Error('Native output transport limit reached')
      const data = bytes.subarray(offset, selected)
      wireBytes += data.length
      offset = selected
      const message = Object.freeze({
        stream,
        sequence,
        data: data.toString('base64'),
        observedBytes: rawBytes,
        redacted: Object.values(streams).some((value) => value.redactor.redacted),
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Native output transport unavailable')), 2000)
        timer.unref()
      })
      const sent = Promise.race([Promise.resolve().then(() => context.send(message)), timeout])
        .catch(() => {
          transportFailed = true
          abort.abort()
        })
        .finally(() => clearTimeout(timer))
      sends.push(sent)
    }
  }
  let result: NativeExecutionResult | undefined,
    failure: unknown,
    failed = false
  try {
    result = await host.exec(
      request,
      (stream, bytes) => {
        context.assertActive()
        signal.throwIfAborted()
        rawBytes += bytes.length
        if (rawBytes > 2 * 1024 * 1024) throw new Error('Native output transport limit reached')
        update()
        emit(stream, streams[stream].redactor.push(streams[stream].decoder.write(bytes)))
      },
      signal,
    )
  } catch (error) {
    failed = true
    failure = error
  }
  try {
    if (!transportFailed) {
      update()
      for (const [name, stream] of Object.entries(streams)) {
        emit(
          name as 'stdout' | 'stderr',
          stream.redactor.push(stream.decoder.end()) + stream.redactor.flush(),
        )
      }
    }
  } catch {
    transportFailed = true
    abort.abort()
  }
  await Promise.all(sends)
  if (
    failed &&
    failure instanceof NativeCommandError &&
    (!failure.cleanupConfirmed || failure.code === 'cancelled' || failure.code === 'timed_out')
  )
    throw failure
  if (transportFailed)
    throw new NativeCommandError(
      'unavailable',
      !failed || (failure instanceof NativeCommandError && failure.cleanupConfirmed),
    )
  if (failed) throw failure
  if (!result) throw new NativeCommandError('unavailable', false)
  return Object.freeze({
    ...result,
    stdoutTruncated: result.stdoutTruncated || stdoutTruncated,
    stderrTruncated: result.stderrTruncated || stderrTruncated,
  })
}
