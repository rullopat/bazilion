import type {
  CreateTokenRequest,
  CreateTokenResponse,
  ListTokensResponse,
  WebToken,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import qrcode from 'qrcode-terminal'
import { readAuthFile } from '../auth-file.ts'
import { createClient, loadClientConfig } from '../client.ts'
import { columnize } from '../columnize.ts'
import { resolveCliPaths } from '../paths.ts'

function tokenRow(t: WebToken): string[] {
  const last = t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : '(never)'
  const expired = t.expiresAt !== null && t.expiresAt <= Date.now()
  const state = t.revokedAt ? 'revoked' : expired ? 'expired' : 'active'
  const expires = t.expiresAt ? new Date(t.expiresAt).toISOString() : '(never)'
  return [t.id, t.kind, state, t.label, `expires: ${expires}`, `last: ${last}`]
}

function resolveQrServer(override: string | undefined): string {
  const raw = override ?? loadClientConfig().serverUrl
  const url = new URL(raw)
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('pairing server must use HTTPS (HTTP is allowed only for loopback development)')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'pairing server must be an exact origin without credentials, path, query, or fragment',
    )
  }
  const cfg = loadClientConfig()
  if (loopback && !override && new URL(cfg.serverUrl).hostname === url.hostname) {
    throw new Error(
      'server URL is loopback-only. Pass --server https://<private-tailnet-host> for mobile pairing.',
    )
  }
  return url.origin
}

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Mint a new web token (shown once)' },
  args: {
    label: { type: 'positional', required: true, description: 'Human-readable label' },
    qr: {
      type: 'boolean',
      description: 'Also render a pairing QR code for mobile clients (bazilion://pair?...)',
    },
    server: {
      type: 'string',
      description:
        'Server URL to embed in the pairing QR (default: detect LAN IP; ignored without --qr)',
    },
    expiresDays: {
      type: 'string',
      description: 'Device lifetime in days (default 90, maximum 365)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const expiresInDays = args.expiresDays === undefined ? undefined : Number(args.expiresDays)
    if (expiresInDays !== undefined && !Number.isInteger(expiresInDays)) {
      throw new Error('--expires-days must be an integer')
    }
    const body: CreateTokenRequest = { label: args.label, expiresInDays }
    const res = await client.post<CreateTokenResponse>('/api/tokens', body)
    console.log(`id:    ${res.meta.id}`)
    console.log(`label: ${res.meta.label}`)
    console.log(`kind:  ${res.meta.kind}`)
    console.log(
      `expires: ${res.meta.expiresAt ? new Date(res.meta.expiresAt).toISOString() : '(never)'}`,
    )
    console.log(`token: ${res.token}`)
    console.log('')
    console.log('store the token now — it is not recoverable later.')

    if (!args.qr) return

    const serverUrl = resolveQrServer(args.server)
    const pairUrl = `bazilion://pair?server=${encodeURIComponent(serverUrl)}&token=${encodeURIComponent(res.token)}`
    console.log('')
    console.log(`pairing URL: ${pairUrl}`)
    console.log('')
    qrcode.generate(pairUrl, { small: true }, (qr) => console.log(qr))
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List web tokens' },
  args: {
    all: { type: 'boolean', description: 'Include revoked tokens' },
  },
  async run({ args }) {
    const client = createClient()
    const qs = args.all ? '?includeRevoked=1' : ''
    const { tokens } = await client.get<ListTokensResponse>(`/api/tokens${qs}`)
    if (tokens.length === 0) {
      console.log('(no tokens)')
      return
    }
    for (const line of columnize(tokens.map(tokenRow))) console.log(line)
  },
})

const showLocalCmd = defineCommand({
  meta: {
    name: 'show-local',
    description: 'Print the bootstrap web token stored in ~/.bazilion/auth.json',
  },
  run() {
    const paths = resolveCliPaths()
    console.log(readAuthFile(paths.authFile).token)
  },
})

const revokeCmd = defineCommand({
  meta: { name: 'revoke', description: 'Revoke a web token' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/tokens/${args.id}`)
    console.log(`revoked token ${args.id}`)
  },
})

export const tokenCommand = defineCommand({
  meta: { name: 'token', description: 'Manage web tokens for API/CLI clients' },
  subCommands: {
    create: createCmd,
    list: listCmd,
    revoke: revokeCmd,
    'show-local': showLocalCmd,
  },
})
