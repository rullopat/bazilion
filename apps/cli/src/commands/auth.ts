// Import pi-ai's provider directly so the CLI bundle stays slim. The provider
// owns its OAuth interaction; Bazilion persists the returned credential in the daemon.
import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export interface OAuthPromptInput {
  once(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  once(event: 'end', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  removeListener(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  removeListener(event: 'end', listener: () => void): unknown
  removeListener(event: 'error', listener: (error: Error) => void): unknown
  pause(): unknown
}

export interface OAuthPromptOutput {
  write(message: string): unknown
}

export type OpenAICodexLoginMethod = 'browser' | 'device_code'

export const CLI_OPENAI_LOGIN_TIMEOUT_MS = 10 * 60_000

export interface CliOpenAILoginLifetime {
  signal: AbortSignal
  dispose(): void
}

/** Keep CLI OAuth bounded even when stdin closes before a browser callback arrives. */
export function createCliOpenAILoginLifetime(
  timeoutMs = CLI_OPENAI_LOGIN_TIMEOUT_MS,
): CliOpenAILoginLifetime {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        'OpenAI login timed out after 10 minutes. Try again with `bazilion auth openai login --device-code`.',
        'TimeoutError',
      ),
    )
  }, timeoutMs)

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
    },
  }
}

function promptAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('OAuth prompt cancelled', 'AbortError')
}

/**
 * Answer Pi's OpenAI OAuth prompts while allowing its localhost callback to
 * cancel a pending manual-code read. Removing the data and abort listeners is
 * essential: a successful browser callback must not leave stdin flowing and
 * keep the CLI process alive.
 */
export function answerCliOpenAIPrompt(
  prompt: AuthPrompt,
  input: OAuthPromptInput = process.stdin,
  output: OAuthPromptOutput = process.stdout,
  loginMethod: OpenAICodexLoginMethod = 'browser',
  loginSignal?: AbortSignal,
): Promise<string> {
  if (prompt.type === 'select') {
    const option = prompt.options.find((candidate) => candidate.id === loginMethod)
    return option
      ? Promise.resolve(option.id)
      : Promise.reject(
          new Error(
            `Pi openai-codex provider does not support ${loginMethod === 'browser' ? 'browser' : 'device-code'} login`,
          ),
        )
  }

  output.write(`${prompt.message}: `)
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const signal = prompt.signal
    let readingInput = true
    const cleanupInput = () => {
      if (!readingInput) return
      readingInput = false
      input.removeListener('data', onData)
      input.removeListener('end', onInputUnavailable)
      input.removeListener('error', onInputUnavailable)
      input.pause()
    }
    const cleanup = () => {
      cleanupInput()
      signal?.removeEventListener('abort', onAbort)
      loginSignal?.removeEventListener('abort', onLoginAbort)
    }
    const onData = (data: string | Buffer) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(String(data).trim())
    }
    const onAbort = () => {
      if (settled || !signal) return
      settled = true
      cleanup()
      reject(promptAbortError(signal))
    }

    const onLoginAbort = () => {
      if (settled || !loginSignal) return
      settled = true
      cleanup()
      reject(promptAbortError(loginSignal))
    }

    // Pi races this prompt against its localhost callback. EOF must stop stdin
    // listeners without rejecting the prompt, because rejecting would cancel a
    // browser callback that may still succeed. The bounded login signal remains
    // responsible for settling a callback that never arrives.
    const onInputUnavailable = () => {
      if (settled) return
      cleanupInput()
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    if (loginSignal?.aborted) {
      onLoginAbort()
      return
    }
    input.once('data', onData)
    input.once('end', onInputUnavailable)
    input.once('error', onInputUnavailable)
    signal?.addEventListener('abort', onAbort, { once: true })
    loginSignal?.addEventListener('abort', onLoginAbort, { once: true })
  })
}

function formatExpiry(ms: number | null): string {
  if (!ms) return '(unknown)'
  const d = new Date(ms)
  return d.toISOString().replace(/\.\d+Z$/, 'Z')
}

const openaiLoginCmd = defineCommand({
  meta: {
    name: 'login',
    description: 'Connect your ChatGPT account via OAuth',
  },
  args: {
    'device-code': {
      type: 'boolean',
      description: 'Use headless device-code login instead of the localhost browser callback',
    },
  },
  async run({ args }) {
    const client = createClient()
    // The loopback callback at localhost:1455 must be on the CLI user's
    // machine, so we run pi-ai's flow client-side (not via a server POST).
    // After it completes we ship the credentials to the daemon so they land
    // in the daemon-owned `secrets` table (encrypted with the bootstrap token).
    const loginMethod: OpenAICodexLoginMethod = args['device-code'] ? 'device_code' : 'browser'
    if (loginMethod === 'device_code') {
      console.log('starting OpenAI device-code sign-in...')
    } else {
      console.log('opening your browser for OpenAI sign-in...')
      console.log("(if it doesn't open automatically, paste the URL shown below)")
    }
    const oauth = openaiCodexProvider().auth.oauth
    if (!oauth) throw new Error('Pi openai-codex provider does not expose OAuth')
    const lifetime = createCliOpenAILoginLifetime()
    const creds = await (async () => {
      try {
        return await oauth.login({
          signal: lifetime.signal,
          notify: (event) => {
            if (event.type === 'auth_url') {
              console.log('')
              console.log(`  → ${event.url}`)
              console.log('')
            } else if (event.type === 'progress' || event.type === 'info') {
              console.log(`  ${event.message}`)
            } else if (event.type === 'device_code') {
              console.log(`  open ${event.verificationUri} and enter ${event.userCode}`)
            }
          },
          prompt: (prompt) =>
            answerCliOpenAIPrompt(
              prompt,
              process.stdin,
              process.stdout,
              loginMethod,
              lifetime.signal,
            ),
        })
      } finally {
        lifetime.dispose()
      }
    })()
    const status = await client.put<OpenAICodexStatus>('/api/auth/openai', {
      refresh: creds.refresh,
      access: creds.access,
      expires: creds.expires,
    })
    console.log('')
    console.log('connected ✓')
    if (status.accountId) console.log(`account: ${status.accountId}`)
    console.log(`access token expires: ${formatExpiry(status.expiresAt)}`)
    console.log('')
    console.log(`enable the 'openai-codex' provider on /config and save at least one model`)
    console.log('(e.g. gpt-5.3-codex-spark, gpt-5.4, gpt-5.5) to start using it.')
    console.log('CLI equivalent:')
    console.log('  bazilion provider enable openai-codex')
    console.log('  bazilion provider models-set openai-codex gpt-5.3-codex-spark')
  },
})

const openaiLogoutCmd = defineCommand({
  meta: {
    name: 'logout',
    description: 'Forget the stored ChatGPT OAuth credentials',
  },
  async run() {
    const client = createClient()
    await client.del('/api/auth/openai')
    console.log('disconnected ChatGPT OAuth credentials')
  },
})

const openaiStatusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Show ChatGPT OAuth connection status',
  },
  async run() {
    const client = createClient()
    const status = await client.get<OpenAICodexStatus>('/api/auth/openai')
    if (!status.connected) {
      console.log('not connected — run `bazilion auth openai login`')
      return
    }
    console.log('connected ✓')
    if (status.accountId) console.log(`account: ${status.accountId}`)
    console.log(`access token expires: ${formatExpiry(status.expiresAt)}`)
  },
})

const openaiCmd = defineCommand({
  meta: {
    name: 'openai',
    description: 'Manage ChatGPT (OAuth) authentication',
  },
  subCommands: {
    login: openaiLoginCmd,
    logout: openaiLogoutCmd,
    status: openaiStatusCmd,
  },
})

export const authCommand = defineCommand({
  meta: {
    name: 'auth',
    description: 'OAuth-based provider authentication (ChatGPT account, etc.)',
  },
  subCommands: {
    openai: openaiCmd,
  },
})
