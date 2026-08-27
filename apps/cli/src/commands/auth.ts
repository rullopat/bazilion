// Import pi-ai's provider directly so the CLI bundle stays slim. The provider
// owns its OAuth interaction; Bazilion persists the returned credential in the daemon.
import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { AuthPrompt } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
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
    const oauth = openaiCodexProvider().auth.oauth
    if (!oauth) throw new Error('Pi openai-codex provider does not expose OAuth')
    const loginController = new AbortController()
    const creds = await oauth.login({
      signal: loginController.signal,
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
      prompt: async (prompt: AuthPrompt): Promise<string> => {
        if (prompt.type === 'select') return prompt.options[0]?.id ?? ''
        process.stdout.write(`${prompt.message}: `)
        return new Promise<string>((resolve) => {
          process.stdin.once('data', (d) => resolve(String(d).trim()))
        })
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
