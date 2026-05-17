// Import pi-ai directly so the CLI bundle stays slim. `loginOpenAICodex` is
// exposed at pi-ai's `/oauth` subpath; types come from pi-ai's main export
// and `OpenAICodexStatus` (the wire shape) from api-types.
import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { OAuthAuthInfo, OAuthPrompt } from '@mariozechner/pi-ai'
import { loginOpenAICodex } from '@mariozechner/pi-ai/oauth'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

function formatExpiry(ms: number | null): string {
  if (!ms) return '(unknown)'
  const d = new Date(ms)
  return d.toISOString().replace(/\.\d+Z$/, 'Z')
}

const openaiLoginCmd = defineCommand({
  meta: {
    name: 'login',
    description: 'Connect your ChatGPT account via OAuth (browser sign-in)',
  },
  async run() {
    const client = createClient()
    // The loopback callback at localhost:1455 must be on the CLI user's
    // machine, so we run pi-ai's flow client-side (not via a server POST).
    // After it completes we ship the credentials to the daemon so they land
    // in the daemon-owned `secrets` table (encrypted with the bootstrap token).
    console.log('opening your browser for OpenAI sign-in...')
    console.log("(if it doesn't open automatically, paste the URL shown below)")
    const creds = await loginOpenAICodex({
      onAuth: ({ url }: OAuthAuthInfo) => {
        console.log('')
        console.log(`  → ${url}`)
        console.log('')
      },
      onPrompt: async (prompt: OAuthPrompt): Promise<string> => {
        process.stdout.write(`${prompt.message}: `)
        return new Promise<string>((resolve) => {
          process.stdin.once('data', (d) => resolve(String(d).trim()))
        })
      },
      onProgress: (msg: string) => {
        console.log(`  ${msg}`)
      },
    })
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
    console.log(`enable the 'openai-codex' provider on /config and add at least one model`)
    console.log('(e.g. gpt-5.1-codex-max, gpt-5.2, gpt-5.3-codex) to start using it.')
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
