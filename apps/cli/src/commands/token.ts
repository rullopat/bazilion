import { networkInterfaces } from 'node:os'
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
  const state = t.revokedAt ? 'revoked' : 'active'
  return [t.id, state, t.label, `last: ${last}`]
}

/**
 * Best-effort LAN host detection for QR pairing. A phone can't reach
 * `127.0.0.1`, so when the server URL is loopback we swap in a routable
 * interface address. Multi-NIC machines get a warning listing every
 * candidate — the user can override with --server.
 */
function detectLanOrigin(port: string): { origin: string; warning?: string } | null {
  const candidates: string[] = []
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs ?? []) {
      if (i.family === 'IPv4' && !i.internal) candidates.push(i.address)
    }
  }
  const [first, ...rest] = candidates
  if (!first) return null
  const origin = `http://${first}:${port}`
  return rest.length > 0
    ? { origin, warning: `multiple LAN IPs found (${candidates.join(', ')}) — using ${first}` }
    : { origin }
}

function resolveQrServer(override: string | undefined): string {
  if (override) return override.replace(/\/$/, '')

  const cfg = loadClientConfig()
  const current = new URL(cfg.serverUrl)
  const isLoopback =
    current.hostname === '127.0.0.1' ||
    current.hostname === 'localhost' ||
    current.hostname === '::1'

  if (!isLoopback) return cfg.serverUrl.replace(/\/$/, '')

  const detected = detectLanOrigin(current.port || '4321')
  if (!detected) {
    throw new Error(
      'server URL is loopback-only and no LAN interface was found. ' +
        'Pass --server http://<host>:<port> so the mobile client knows where to connect.',
    )
  }
  if (detected.warning) console.warn(`⚠ ${detected.warning}`)
  return detected.origin
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
  },
  async run({ args }) {
    const client = createClient()
    const body: CreateTokenRequest = { label: args.label }
    const res = await client.post<CreateTokenResponse>('/api/tokens', body)
    console.log(`id:    ${res.meta.id}`)
    console.log(`label: ${res.meta.label}`)
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
