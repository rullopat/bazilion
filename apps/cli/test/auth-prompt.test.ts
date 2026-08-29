import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { expect, test, vi } from 'vitest'
import {
  answerCliOpenAIPrompt,
  createCliOpenAILoginLifetime,
  type OAuthPromptInput,
  type OAuthPromptOutput,
} from '../src/commands/auth.ts'

class FakeInput extends EventEmitter implements OAuthPromptInput {
  pause = vi.fn()
}

function fakeOutput(): OAuthPromptOutput & { writes: string[] } {
  const writes: string[] = []
  return {
    writes,
    write(message) {
      writes.push(message)
    },
  }
}

test('CLI OAuth removes the stdin listener when the browser callback wins', async () => {
  const input = new FakeInput()
  const output = fakeOutput()
  const controller = new AbortController()
  const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
  const prompt: AuthPrompt = {
    type: 'manual_code',
    message: 'Paste the callback URL',
    signal: controller.signal,
  }
  const pending = answerCliOpenAIPrompt(prompt, input, output)

  expect(input.listenerCount('data')).toBe(1)
  expect(output.writes).toEqual(['Paste the callback URL: '])

  const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await aborted

  expect(input.listenerCount('data')).toBe(0)
  expect(input.pause).toHaveBeenCalledOnce()
  expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
})

test('CLI OAuth removes cancellation hooks after manual input', async () => {
  const input = new FakeInput()
  const output = fakeOutput()
  const controller = new AbortController()
  const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
  const pending = answerCliOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: controller.signal,
    },
    input,
    output,
  )

  input.emit('data', Buffer.from('  callback-code\n'))

  await expect(pending).resolves.toBe('callback-code')
  expect(input.listenerCount('data')).toBe(0)
  expect(input.pause).toHaveBeenCalledOnce()
  expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
})

test.each([
  'end',
  'error',
] as const)('CLI OAuth stops reading after stdin %s but leaves the browser callback in charge', async (event) => {
  const input = new FakeInput()
  const promptController = new AbortController()
  const loginController = new AbortController()
  const pending = answerCliOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: promptController.signal,
    },
    input,
    fakeOutput(),
    'browser',
    loginController.signal,
  )

  if (event === 'error') input.emit(event, new Error('stdin failed'))
  else input.emit(event)

  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('end')).toBe(0)
  expect(input.listenerCount('error')).toBe(0)
  expect(input.pause).toHaveBeenCalledOnce()

  const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  promptController.abort()
  await aborted
})

test('CLI OAuth bounds a manual prompt after stdin closes and no callback arrives', async () => {
  const input = new FakeInput()
  const lifetime = createCliOpenAILoginLifetime(5)
  const pending = answerCliOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: new AbortController().signal,
    },
    input,
    fakeOutput(),
    'browser',
    lifetime.signal,
  )

  input.emit('end')

  try {
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
  } finally {
    lifetime.dispose()
  }
})

test('CLI OAuth preserves automatic browser login without touching stdin', async () => {
  const input = new FakeInput()
  const output = fakeOutput()

  await expect(
    answerCliOpenAIPrompt(
      {
        type: 'select',
        message: 'Select login method',
        options: [
          { id: 'device_code', label: 'Device code login' },
          { id: 'browser', label: 'Browser login (default)' },
        ],
      },
      input,
      output,
    ),
  ).resolves.toBe('browser')
  expect(input.listenerCount('data')).toBe(0)
  expect(input.pause).not.toHaveBeenCalled()
  expect(output.writes).toEqual([])
})

test('CLI OAuth selects Pi device-code login when requested', async () => {
  const input = new FakeInput()
  const output = fakeOutput()

  await expect(
    answerCliOpenAIPrompt(
      {
        type: 'select',
        message: 'Select login method',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login' },
        ],
      },
      input,
      output,
      'device_code',
    ),
  ).resolves.toBe('device_code')
  expect(input.listenerCount('data')).toBe(0)
  expect(input.pause).not.toHaveBeenCalled()
  expect(output.writes).toEqual([])
})
