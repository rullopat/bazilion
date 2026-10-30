import type { NativeExecutionOutput } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'
import { dispatchNativeExecution } from '../../src/runtime/worker/native-execution-dispatch.ts'

const result = { code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false }
test('credential-bearing native commands refuse before invoking any executor', async () => {
  let invoked = false
  await expect(
    dispatchNativeExecution(
      { toolCallId: 'refuse', command: 'printf private-command-value', cwd: '.', timeoutMs: 1000 },
      {
        cancel: () => false,
        async exec() {
          invoked = true
          return result
        },
      },
      {
        assertActive() {},
        secrets: () => ['private-command-value'],
        async send() {
          throw new Error('must not send')
        },
      },
    ),
  ).rejects.toMatchObject({ code: 'unavailable', cleanupConfirmed: true })
  expect(invoked).toBe(false)
})

test('producer capture facts preserve raw byte counts when redaction expands the delivered bytes', async () => {
  const parts: NativeExecutionOutput[] = []
  await dispatchNativeExecution(
    { toolCallId: 'capture', command: 'printf a', cwd: '.', timeoutMs: 1000 },
    {
      cancel: () => false,
      async exec(_input, output) {
        output('stdout', Buffer.from('x'))
        return result
      },
    },
    {
      assertActive() {},
      secrets: () => ['x'],
      async send(part) {
        parts.push(part)
      },
    },
  )
  expect(parts).toHaveLength(1)
  expect(parts[0]).toMatchObject({ observedBytes: 1, redacted: true })
  expect(Buffer.from(parts[0]?.data ?? '', 'base64').toString()).toBe('[REDACTED]')
})

test.each([
  { observedBytes: 0, redacted: true },
  { observedBytes: 0.5, redacted: true },
  { observedBytes: 3, redacted: false },
  { observedBytes: 2, redacted: true },
  { observedBytes: 2 * 1024 * 1024 + 1, redacted: true },
])('nonmonotonic/invalid native capture facts cannot end an invocation before terminal cleanup: %j', async (invalid) => {
  let receive: (value: unknown) => void = () => {},
    id = ''
  const call = createIpcClient({
    send(value, done) {
      id = value.id
      done(null)
    },
    onMessage(listener) {
      receive = listener
    },
    onDisconnect() {},
  })
  let settled = false
  const pending = call('nativeExecute', {}, { onNativeOutput() {} })
  void pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  receive({
    type: 'rpc-output',
    id,
    sequence: 1,
    stream: 'stdout',
    data: Buffer.from('[REDACTED]').toString('base64'),
    observedBytes: 3,
    redacted: true,
  })
  receive({
    type: 'rpc-output',
    id,
    sequence: 2,
    stream: 'stdout',
    data: Buffer.from('data').toString('base64'),
    ...invalid,
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  receive({ type: 'rpc-reply', id, ok: true, result })
  await expect(pending).rejects.toThrow('Invalid native IPC output')
})

test('IPC capture counts may be smaller than sanitized byte counts without inventing truncation', async () => {
  let receive: (value: unknown) => void = () => {},
    id = ''
  const parts: NativeExecutionOutput[] = []
  const call = createIpcClient({
    send(value, done) {
      id = value.id
      done(null)
    },
    onMessage(listener) {
      receive = listener
    },
    onDisconnect() {},
  })
  const pending = call(
    'nativeExecute',
    {},
    {
      onNativeOutput(part) {
        parts.push(part)
      },
    },
  )
  receive({
    type: 'rpc-output',
    id,
    sequence: 1,
    stream: 'stdout',
    data: Buffer.from('[REDACTED]').toString('base64'),
    observedBytes: 1,
    redacted: true,
  })
  receive({ type: 'rpc-reply', id, ok: true, result })
  await expect(pending).resolves.toEqual(result)
  expect(parts[0]).toMatchObject({ observedBytes: 1, redacted: true })
})
