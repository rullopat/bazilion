import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import { answerCliOpenAIPrompt } from '../src/commands/auth.ts'

class FakeInput extends EventEmitter {
  pause = vi.fn()
}

function fakeOutput() {
  const writes: string[] = []
  return { writes, write: (message: string) => writes.push(message) > 0 }
}

const selectPrompt = {
  type: 'select' as const,
  message: 'Select login method',
  options: [
    { id: 'browser', label: 'Browser login (default)' },
    { id: 'device_code', label: 'Device code login' },
  ],
}

/** A signal nobody aborts. */
const idle = () => new AbortController().signal

test('CLI OAuth picks the requested login method without touching stdin', async () => {
  const input = new FakeInput()
  const output = fakeOutput()
  await expect(answerCliOpenAIPrompt(selectPrompt, 'browser', idle(), input, output)).resolves.toBe(
    'browser',
  )
  await expect(
    answerCliOpenAIPrompt(selectPrompt, 'device_code', idle(), input, output),
  ).resolves.toBe('device_code')
  expect(input.listenerCount('data')).toBe(0)
  expect(output.writes).toEqual([])
})

test('CLI OAuth reads one pasted line and releases stdin', async () => {
  const input = new FakeInput()
  const output = fakeOutput()
  const pending = answerCliOpenAIPrompt(
    { type: 'manual_code', message: 'Paste the callback URL', signal: idle() },
    'browser',
    idle(),
    input,
    output,
  )
  expect(output.writes).toEqual(['Paste the callback URL: '])
  input.emit('data', Buffer.from('http://127.0.0.1:1455/auth/callback?code=c\n'))
  await expect(pending).resolves.toBe('http://127.0.0.1:1455/auth/callback?code=c')
  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('error')).toBe(0)
  expect(input.pause).toHaveBeenCalled()
})

test('CLI OAuth releases stdin when the browser callback wins', async () => {
  const input = new FakeInput()
  const controller = new AbortController()
  const pending = answerCliOpenAIPrompt(
    { type: 'manual_code', message: 'Paste the callback URL', signal: controller.signal },
    'browser',
    idle(),
    input,
    fakeOutput(),
  )
  expect(input.listenerCount('data')).toBe(1)
  controller.abort()
  await expect(pending).rejects.toThrow(/withdrawn/)
  // A flowing stdin would keep the CLI alive after a successful login.
  expect(input.listenerCount('data')).toBe(0)
  expect(input.pause).toHaveBeenCalled()
})

test('CLI OAuth paste prompt ends with the login even when Pi never withdraws it', async () => {
  // With port 1455 taken Pi has no callback server and waits on this prompt alone, aborting its
  // signal only after the prompt settles: the login timeout must end it, even after stdin closed.
  const input = new FakeInput()
  const login = new AbortController()
  const pending = answerCliOpenAIPrompt(
    { type: 'manual_code', message: 'Paste the callback URL', signal: idle() },
    'browser',
    login.signal,
    input,
    fakeOutput(),
  )
  input.emit('end')
  login.abort()
  await expect(pending).rejects.toThrow(/withdrawn/)
  expect(input.listenerCount('data')).toBe(0)
})

test('CLI OAuth stops reading after a stdin error but leaves the browser callback in charge', async () => {
  const input = new FakeInput()
  const controller = new AbortController()
  let settled = false
  const pending = answerCliOpenAIPrompt(
    { type: 'manual_code', message: 'Paste the callback URL', signal: controller.signal },
    'browser',
    idle(),
    input,
    fakeOutput(),
  )
  pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  // Without a listener this would be an uncaught 'error' event.
  input.emit('error', new Error('stdin failed'))
  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('error')).toBe(0)
  expect(input.pause).toHaveBeenCalled()
  await new Promise((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)

  controller.abort()
  await expect(pending).rejects.toThrow(/withdrawn/)
})
