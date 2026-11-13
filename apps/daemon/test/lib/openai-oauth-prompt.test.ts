import { createServer } from 'node:net'
import { expect, test, vi } from 'vitest'
import {
  answerWebOpenAIPrompt,
  preflightOpenAICodexCallback,
  webOpenAILoginError,
} from '../../src/lib/openai-oauth-prompt.ts'
import { loginOpenAICodex } from '../../src/runtime/auth/openai-codex.ts'

/** Whether `promise` is still pending after the current I/O turn. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  let pending = true
  promise.then(
    () => {
      pending = false
    },
    () => {
      pending = false
    },
  )
  await new Promise((resolve) => setImmediate(resolve))
  return pending
}

test('web OAuth keeps the paste prompt pending until Pi withdraws it', async () => {
  const withdraw = new AbortController()
  const pending = answerWebOpenAIPrompt(
    { type: 'manual_code', message: 'Paste the callback URL', signal: withdraw.signal },
    new AbortController().signal,
  )
  // Rejecting early would cancel Pi's wait for the browser callback.
  expect(await isPending(pending)).toBe(true)

  withdraw.abort()
  await expect(pending).rejects.toThrow(/ended/)
})

test('web OAuth paste prompt ends with the login even when Pi never withdraws it', async () => {
  // Without a callback server Pi waits on this prompt alone and aborts its signal only after the
  // prompt settles, so the login signal (timeout, request gone, opener failure) must end it.
  const login = new AbortController()
  const pending = answerWebOpenAIPrompt(
    {
      type: 'manual_code',
      message: 'Paste the callback URL',
      signal: new AbortController().signal,
    },
    login.signal,
  )
  expect(await isPending(pending)).toBe(true)

  login.abort(new DOMException('timeout', 'TimeoutError'))
  await expect(pending).rejects.toThrow(/ended/)

  // A login that already ended rejects the prompt at once.
  await expect(
    answerWebOpenAIPrompt({ type: 'manual_code', message: 'Paste' }, login.signal),
  ).rejects.toThrow(/ended/)
})

test("Pi's web login ends on its signal when Pi has no callback server", async () => {
  // An address this host cannot bind fails Pi's callback server the way a port 1455 taken after
  // the preflight does; Pi then swallows the bind error and waits on the paste prompt alone.
  vi.stubEnv('PI_OAUTH_CALLBACK_HOST', '192.0.2.1')
  try {
    const login = new AbortController()
    let opened!: () => void
    const authUrl = new Promise<void>((resolve) => {
      opened = resolve
    })
    const result = loginOpenAICodex({
      signal: login.signal,
      notify: (event) => {
        if (event.type === 'auth_url') opened()
      },
      prompt: (prompt) => answerWebOpenAIPrompt(prompt, login.signal),
    })
    await authUrl
    expect(await isPending(result)).toBe(true)

    login.abort(new DOMException('timeout', 'TimeoutError'))
    await expect(result).rejects.toThrow(/OpenAI browser login ended/)
  } finally {
    vi.unstubAllEnvs()
  }
})

test('web OAuth selects browser login', async () => {
  await expect(
    answerWebOpenAIPrompt(
      {
        type: 'select',
        message: 'Select login method',
        options: [
          { id: 'device_code', label: 'Device code login' },
          { id: 'browser', label: 'Browser login (default)' },
        ],
      },
      new AbortController().signal,
    ),
  ).resolves.toBe('browser')
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
    await expect(preflightOpenAICodexCallback('127.0.0.1', address.port)).rejects.toThrow(
      /already in use.*bazilion auth openai login --device-code/s,
    )
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
  }
  // A free address is claimed and released again.
  await expect(preflightOpenAICodexCallback('127.0.0.1', address.port)).resolves.toBeUndefined()
})

test('a timed-out or failed web login names its cause', () => {
  const timedOut = new AbortController()
  timedOut.abort(new DOMException('timeout', 'TimeoutError'))
  expect(webOpenAILoginError(new Error('Login cancelled'), timedOut.signal)).toMatch(
    /timed out after 10 minutes.*--device-code/,
  )

  const launchFailed = new AbortController()
  launchFailed.abort(new Error('Could not open the OpenAI sign-in page with xdg-open: exited 3.'))
  expect(webOpenAILoginError(new Error('Login cancelled'), launchFailed.signal)).toMatch(
    /xdg-open: exited 3/,
  )

  expect(
    webOpenAILoginError(new Error('token exchange failed'), new AbortController().signal),
  ).toBe('token exchange failed')
})
