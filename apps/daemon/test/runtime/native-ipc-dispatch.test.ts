import type { NativeExecutionOutput } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { NativeCommandError } from '../../src/lib/native-execution/command.ts'
import type { WorkerIpcCall, WorkerIpcCallOptions } from '../../src/runtime/worker/ipc-client.ts'
import type { NativeExecutionHost, RpcMethod } from '../../src/runtime/worker/ipc-protocol.ts'
import { createIpcNativeExecutionHost } from '../../src/runtime/worker/native-execution-client.ts'
import { dispatchNativeExecution } from '../../src/runtime/worker/native-execution-dispatch.ts'

const request = { toolCallId: 'one', command: 'controlled command', cwd: '.', timeoutMs: 1000 }
const result = { code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false }
test('native IPC redacts split credentials and UTF-8 before base64 encoding with a live supplier', async () => {
  let secrets = ['initial-long-secret-that-holds-the-prefix']
  const parts: NativeExecutionOutput[] = []
  const host: NativeExecutionHost = {
    cancel() {
      return false
    },
    async exec(_request, output) {
      output('stdout', Buffer.from('new-'))
      secrets = [...secrets, 'new-secret']
      output('stdout', Buffer.from('secret'))
      const unicode = Buffer.from(' café ')
      output('stdout', unicode.subarray(0, 5))
      output('stdout', unicode.subarray(5))
      return result
    },
  }
  await expect(
    dispatchNativeExecution(request, host, {
      assertActive() {},
      secrets: () => secrets,
      async send(part) {
        parts.push(part)
      },
    }),
  ).resolves.toEqual(result)
  const text = parts.map((part) => Buffer.from(part.data, 'base64').toString()).join('')
  expect(text).toBe('[REDACTED] café ')
  expect(parts.map((part) => part.sequence)).toEqual(parts.map((_part, index) => index + 1))
  expect(parts.at(-1)).toMatchObject({
    observedBytes: Buffer.byteLength('new-secret café '),
    redacted: true,
  })
})
test('post-redaction expansion is independently bounded and stored truncation is explicit', async () => {
  const parts: NativeExecutionOutput[] = []
  const host: NativeExecutionHost = {
    cancel() {
      return false
    },
    async exec(_request, output) {
      output('stdout', Buffer.alloc(1024 * 1024, 120))
      return result
    },
  }
  const value = await dispatchNativeExecution(request, host, {
    assertActive() {},
    secrets: () => ['x'],
    async send(part) {
      parts.push(part)
    },
  })
  expect(value.stdoutTruncated).toBe(true)
  expect(parts.reduce((total, part) => total + Buffer.from(part.data, 'base64').length, 0)).toBe(
    2 * 1024 * 1024,
  )
  expect(parts.every((part) => Buffer.from(part.data, 'base64').length <= 64 * 1024)).toBe(true)
})
test('native output transport failure is bounded and cannot hide unconfirmed retirement', async () => {
  const host: NativeExecutionHost = {
    cancel() {
      return false
    },
    async exec(_request, output) {
      output('stdout', Buffer.from('private'))
      throw new NativeCommandError('recovery_required', false)
    },
  }
  await expect(
    dispatchNativeExecution(request, host, {
      assertActive() {},
      secrets: () => [],
      async send() {
        throw new Error('private transport cause')
      },
    }),
  ).rejects.toMatchObject({ code: 'recovery_required', cleanupConfirmed: false })
})
test('post-result cancellation can lose a buffered transport tail without losing positive cleanup facts', async () => {
  // Codec-only controlled transport: actual kernel/ownership qualification is separate.
  const stop = new AbortController()
  const host: NativeExecutionHost = {
    cancel() {
      return false
    },
    async exec(_request, output) {
      output('stdout', Buffer.from('ok'))
      stop.abort()
      return result
    },
  }
  await expect(
    dispatchNativeExecution(request, host, {
      assertActive() {
        stop.signal.throwIfAborted()
      },
      secrets: () => ['long-controlled-lookbehind-value'],
      signal: stop.signal,
      async send() {
        throw new Error('cancelled output must not be delivered')
      },
    }),
  ).rejects.toMatchObject({ code: 'unavailable', cleanupConfirmed: true })
})

test('worker native proxy keeps cancellation correlated and decodes only validated output/result shapes', async () => {
  const calls: string[] = [],
    abort = new AbortController()
  const call: WorkerIpcCall = async <T>(
    method: RpcMethod,
    _args: unknown,
    options?: WorkerIpcCallOptions,
  ) => {
    calls.push(method)
    if (method === 'nativeExecute') {
      options?.onNativeOutput?.({
        sequence: 1,
        stream: 'stdout',
        data: Buffer.from('controlled').toString('base64'),
        observedBytes: 10,
        redacted: false,
      })
      return result as T
    }
    return { requested: true } as T
  }
  let output = ''
  const proxy = createIpcNativeExecutionHost(call)
  await expect(
    proxy.exec(
      request,
      (_stream, bytes) => {
        output += bytes.toString()
        abort.abort()
      },
      abort.signal,
    ),
  ).resolves.toEqual(result)
  expect(output).toBe('controlled')
  expect(calls).toEqual(['nativeExecute', 'nativeCancel'])
  const malformed: WorkerIpcCall = async <T>() =>
    ({
      code: 0,
      signal: null,
      stdoutTruncated: false,
      stderrTruncated: false,
      backend: 'host',
    }) as T
  await expect(createIpcNativeExecutionHost(malformed).exec(request, () => {})).rejects.toThrow(
    'Invalid native execution reply',
  )
})
