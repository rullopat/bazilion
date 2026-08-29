import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { expect, test, vi } from 'vitest'
import {
  acquireWebOpenAILogin,
  answerWebOpenAIPrompt,
  createWebOpenAILoginLifetime,
  launchOpenAICodexBrowser,
  type OAuthBrowserProcess,
  preflightOpenAICodexCallback,
} from '../../src/lib/openai-oauth-prompt.ts'

class FakeBrowserProcess extends EventEmitter {
  unref = vi.fn()
}

test('web OAuth keeps the manual-code prompt pending until the callback aborts it', async () => {
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const prompt: AuthPrompt = {
    type: 'manual_code',
    message: 'Paste the callback URL',
    signal: controller.signal,
  }
  let outcome = 'pending'
  const pending = answerWebOpenAIPrompt(prompt)
  void pending.then(
    () => {
      outcome = 'resolved'
    },
    () => {
      outcome = 'rejected'
    },
  )

  await Promise.resolve()
  expect(outcome).toBe('pending')

  const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await aborted
  expect(outcome).toBe('rejected')
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})

test('web OAuth settles an already-aborted manual-code prompt', async () => {
  const controller = new AbortController()
  controller.abort()

  await expect(
    answerWebOpenAIPrompt({
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
})

test('web OAuth preserves automatic browser login as the default selection', async () => {
  await expect(
    answerWebOpenAIPrompt({
      type: 'select',
      message: 'Select login method',
      options: [
        { id: 'device', label: 'Device code login' },
        { id: 'browser', label: 'Browser login (default)' },
      ],
    }),
  ).resolves.toBe('browser')
})

test('web OAuth opens Windows URLs without cmd metacharacter parsing', () => {
  const child = new FakeBrowserProcess()
  const spawnBrowser = vi.fn(() => child as unknown as OAuthBrowserProcess)
  const url = 'https://example.com/oauth?state=one&redirect=two'

  launchOpenAICodexBrowser(url, vi.fn(), {
    platform: 'win32',
    spawnBrowser,
  })

  expect(spawnBrowser).toHaveBeenCalledWith('rundll32.exe', ['url.dll,FileProtocolHandler', url])
  expect(child.unref).toHaveBeenCalledOnce()
})

test('web OAuth manual prompt also follows the route-level request signal', async () => {
  const piPromptController = new AbortController()
  const requestController = new AbortController()
  const lifetime = createWebOpenAILoginLifetime(requestController.signal, 1_000)
  const pending = answerWebOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: piPromptController.signal,
    },
    lifetime.signal,
  )

  try {
    const aborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    requestController.abort()
    await aborted
    expect(piPromptController.signal.aborted).toBe(false)
  } finally {
    lifetime.dispose()
  }
})

test('web OAuth manual prompt settles when the bounded login window expires', async () => {
  const lifetime = createWebOpenAILoginLifetime(undefined, 5)
  const pending = answerWebOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: new AbortController().signal,
    },
    lifetime.signal,
  )

  try {
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
  } finally {
    lifetime.dispose()
  }
})

test('web OAuth preflight reports an occupied callback port with device-code guidance', async () => {
  const occupied = createServer()
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const address = occupied.address()
  if (!address || typeof address === 'string') throw new Error('expected an IP callback address')

  try {
    await expect(
      preflightOpenAICodexCallback({ host: '127.0.0.1', port: address.port }),
    ).rejects.toThrow(/already in use.*bazilion auth openai login --device-code/s)
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  }
})

test('web OAuth serializes login attempts until the active attempt releases its slot', async () => {
  const releaseFirst = await acquireWebOpenAILogin()
  let secondAcquired = false
  let releaseSecond: (() => void) | undefined
  const second = acquireWebOpenAILogin().then((release) => {
    secondAcquired = true
    releaseSecond = release
  })

  try {
    await Promise.resolve()
    expect(secondAcquired).toBe(false)
    releaseFirst()
    await second
    expect(secondAcquired).toBe(true)
  } finally {
    releaseFirst()
    releaseSecond?.()
  }
})

test('web OAuth aborts its login lifetime when the browser opener reports an async error', () => {
  const lifetime = createWebOpenAILoginLifetime(undefined, 1_000)
  const child = new FakeBrowserProcess()
  launchOpenAICodexBrowser('https://example.com/oauth', (error) => lifetime.abort(error), {
    platform: 'linux',
    spawnBrowser: () => child as unknown as OAuthBrowserProcess,
  })

  try {
    child.emit('error', new Error('spawn ENOENT'))
    expect(lifetime.signal.aborted).toBe(true)
    expect((lifetime.signal.reason as Error).message).toMatch(
      /xdg-open.*spawn ENOENT.*bazilion auth openai login --device-code/s,
    )
    expect(child.unref).toHaveBeenCalledOnce()
  } finally {
    lifetime.dispose()
  }
})

test('web OAuth reports an early non-zero browser opener exit once', () => {
  const child = new FakeBrowserProcess()
  const onFailure = vi.fn()
  launchOpenAICodexBrowser('https://example.com/oauth', onFailure, {
    platform: 'linux',
    spawnBrowser: () => child as unknown as OAuthBrowserProcess,
  })

  child.emit('exit', 3, null)
  child.emit('error', new Error('late error'))

  expect(onFailure).toHaveBeenCalledOnce()
  expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
    message: expect.stringMatching(/xdg-open.*exited 3.*--device-code/s),
  })
})
