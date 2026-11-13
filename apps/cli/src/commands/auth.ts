// Import pi-ai's provider directly so the CLI bundle stays slim. The provider
// owns its OAuth interaction; Bazilion persists the returned credential in the daemon.
import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

type OpenAICodexLoginMethod = 'browser' | 'device_code'

const CLI_OPENAI_LOGIN_TIMEOUT_MS = 10 * 60_000

interface PromptInput {
  once(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'data', listener: (chunk: string | Buffer) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  pause(): unknown
}

/**
 * Answer Pi's OpenAI login prompts in a terminal: pick the login method, or read one line (a
 * pasted redirect URL). The paste prompt ends when Pi withdraws it (the browser callback arrived
 * first) or when `login` ends; stdin is then released so it cannot keep the CLI running. The login
 * signal matters when port 1455 is taken: Pi then has no callback server and waits on this prompt
 * alone. A stdin error only stops the reading, since the browser callback may still arrive.
 */
export function answerCliOpenAIPrompt(
  prompt: AuthPrompt,
  loginMethod: OpenAICodexLoginMethod,
  login: AbortSignal,
  input: PromptInput = process.stdin,
  output: { write(text: string): unknown } = process.stdout,
): Promise<string> {
  if (prompt.type === 'select') {
    return prompt.options.some((option) => option.id === loginMethod)
      ? Promise.resolve(loginMethod)
      : Promise.reject(
          new Error(
            `Pi openai-codex provider does not support ${loginMethod === 'browser' ? 'browser' : 'device-code'} login`,
          ),
        )
  }
  output.write(`${prompt.message}: `)
  const ended = prompt.signal ? AbortSignal.any([prompt.signal, login]) : login
  return new Promise<string>((resolve, reject) => {
    const stopReading = () => {
      input.off('data', onData)
      input.off('error', stopReading)
      input.pause()
    }
    const onData = (data: string | Buffer) => {
      stopReading()
      ended.removeEventListener('abort', onEnded)
      resolve(String(data).trim())
    }
    const onEnded = () => {
      stopReading()
      reject(new Error('OAuth prompt withdrawn'))
    }
    if (ended.aborted) return onEnded()
    input.once('data', onData)
    input.once('error', stopReading)
    ended.addEventListener('abort', onEnded, { once: true })
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
    // A ref'd timer (unlike AbortSignal.timeout) keeps the CLI alive for the whole login window,
    // so a login nothing can finish ends with the timeout error instead of a silent exit.
    const login = new AbortController()
    const timer = setTimeout(() => login.abort(), CLI_OPENAI_LOGIN_TIMEOUT_MS)
    const creds = await oauth
      .login({
        signal: login.signal,
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
        prompt: (prompt) => answerCliOpenAIPrompt(prompt, loginMethod, login.signal),
      })
      .catch((error: unknown) => {
        throw login.signal.aborted
          ? new Error(
              'OpenAI login timed out after 10 minutes. Try again, or use `bazilion auth openai login --device-code`.',
            )
          : error
      })
      .finally(() => clearTimeout(timer))
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
    console.log('to start using it. CLI equivalent:')
    console.log('  bazilion provider enable openai-codex')
    console.log('  bazilion provider models openai-codex      # lists the catalog')
    console.log('  bazilion provider models-set openai-codex <model>')
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
