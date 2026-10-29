import { expect, test } from 'vitest'
import { createIpcClient, WorkerNativeExecutionError } from '../../src/runtime/worker/ipc-client.ts'
import type { IpcRequest } from '../../src/runtime/worker/ipc-protocol.ts'

function fixture() {
  let receive: (message: unknown) => void = () => {},
    disconnect = () => {}
  const sent: IpcRequest[] = []
  const call = createIpcClient({
    send(message, done) {
      sent.push(message)
      done(null)
    },
    onMessage(listener) {
      receive = listener
    },
    onDisconnect(listener) {
      disconnect = listener
    },
  })
  const id = () => {
    const value = sent[0]?.id
    if (!value) throw Error('missing request')
    return value
  }
  let observedBytes = 0
  const output = (
    sequence: number,
    data = Buffer.from('output').toString('base64'),
    stream = 'stdout',
  ) => {
    observedBytes += Buffer.from(data, 'base64').length
    receive({
      type: 'rpc-output',
      id: id(),
      sequence,
      data,
      stream,
      observedBytes,
      redacted: false,
    })
  }
  const reply = (
    result: unknown = { code: 0, signal: null, stdoutTruncated: false, stderrTruncated: false },
  ) => receive({ type: 'rpc-reply', id: id(), ok: true, result })
  return { call, sent, id, output, reply, receive, disconnect }
}
test('native IPC correlates ordered bounded output with the original pending invocation', async () => {
  const f = fixture(),
    parts: string[] = []
  const promise = f.call(
    'nativeExecute',
    {},
    {
      onNativeOutput(part) {
        parts.push(Buffer.from(part.data, 'base64').toString())
      },
    },
  )
  f.receive({
    type: 'rpc-output',
    id: 'foreign',
    sequence: 1,
    stream: 'stdout',
    data: 'Zm9yZWlnbg==',
  })
  f.output(1)
  f.output(2, Buffer.from('error').toString('base64'), 'stderr')
  f.reply()
  await expect(promise).resolves.toMatchObject({ code: 0 })
  expect(parts).toEqual(['output', 'error'])
  f.output(3)
  expect(parts).toHaveLength(2)
})
test.each([
  { sequence: 2 },
  { sequence: 1, data: 'not canonical base64!' },
  { sequence: 1, stream: 'control' },
  { sequence: 1, data: Buffer.alloc(64 * 1024 + 1).toString('base64') },
])('malformed native output waits for terminal cleanup rather than ending the invocation early: %j', async (invalid) => {
  const f = fixture()
  let settled = false
  const promise = f.call(
    'nativeExecute',
    {},
    {
      onNativeOutput() {
        throw Error('must not deliver')
      },
    },
  )
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  f.output(invalid.sequence, invalid.data, invalid.stream)
  await Promise.resolve()
  expect(settled).toBe(false)
  f.reply()
  await expect(promise).rejects.toThrow('Invalid native IPC output')
})
test('output callback failure cannot finish a native effect before its terminal reply', async () => {
  const f = fixture()
  let settled = false
  const promise = f.call(
    'nativeExecute',
    {},
    {
      onNativeOutput() {
        throw Error('closed-output-canary')
      },
    },
  )
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  f.output(1)
  await Promise.resolve()
  expect(settled).toBe(false)
  f.reply()
  await expect(promise).rejects.toThrow('closed-output-canary')
})
test('native structured cleanup failure takes precedence over output failure', async () => {
  const f = fixture(),
    promise = f.call(
      'nativeExecute',
      {},
      {
        onNativeOutput() {
          throw Error('output failed')
        },
      },
    )
  f.output(1)
  f.receive({
    type: 'rpc-reply',
    id: f.id(),
    ok: false,
    error: 'Native cleanup unconfirmed',
    nativeFailure: { code: 'recovery_required', cleanupConfirmed: false },
  })
  await expect(promise).rejects.toBeInstanceOf(WorkerNativeExecutionError)
  await expect(promise).rejects.toMatchObject({
    code: 'recovery_required',
    cleanupConfirmed: false,
  })
})
test('native IPC retains only validated copied closed failure observations', async () => {
  const f = fixture(),
    promise = f.call('nativeExecute', {})
  const observation = {
    backend: 'darwin-seatbelt',
    phase: 'census',
    ownerLive: true,
    commandCompleted: true,
    commandNaturalEOF: true,
    fenced: true,
    terminalProof: false,
    captures: ['drift', 'drift'],
  }
  f.receive({
    type: 'rpc-reply',
    id: f.id(),
    ok: false,
    error: 'Native execution recovery_required',
    nativeFailure: { code: 'recovery_required', cleanupConfirmed: false, observation },
  })
  observation.captures[0] = 'unknown'
  await expect(promise).rejects.toMatchObject({
    code: 'recovery_required',
    cleanupConfirmed: false,
    observation: { captures: ['drift', 'drift'] },
  })
})
test('native IPC refuses diagnostic authority fields rather than accepting them as cleanup facts', async () => {
  const f = fixture(),
    promise = f.call('nativeExecute', {})
  f.receive({
    type: 'rpc-reply',
    id: f.id(),
    ok: false,
    error: 'Native execution recovery_required',
    nativeFailure: {
      code: 'recovery_required',
      cleanupConfirmed: false,
      observation: { pid: 123 },
    },
  })
  await expect(promise).rejects.not.toBeInstanceOf(WorkerNativeExecutionError)
})
test('native output total is bounded independently of frame size', async () => {
  const f = fixture(),
    promise = f.call('nativeExecute', {}, { onNativeOutput() {} }),
    data = Buffer.alloc(64 * 1024).toString('base64')
  for (let sequence = 1; sequence <= 33; sequence++) f.output(sequence, data)
  f.reply()
  await expect(promise).rejects.toThrow('Invalid native IPC output')
})
test('disconnect clears native correlation and refuses future requests without replay', async () => {
  const f = fixture(),
    promise = f.call(
      'nativeExecute',
      {},
      {
        onNativeOutput() {
          throw Error('late output')
        },
      },
    )
  const rejected = expect(promise).rejects.toThrow('disconnected')
  f.disconnect()
  await rejected
  expect(() => f.output(1)).not.toThrow()
  await expect(f.call('nativeExecute', {})).rejects.toThrow('disconnected')
  expect(f.sent).toHaveLength(1)
})
