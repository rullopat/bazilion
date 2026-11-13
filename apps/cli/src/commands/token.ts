import type {
  CreateTokenRequest,
  CreateTokenResponse,
  ListTokensResponse,
  WebToken,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { readAuthFile } from '../auth-file.ts'
import { createClient } from '../client.ts'
import { apiPath, positional, printRows } from '../command-helpers.ts'
import { resolveCliPaths } from '../paths.ts'

function tokenRow(t: WebToken): string[] {
  const last = t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : '(never)'
  const expired = t.expiresAt !== null && t.expiresAt <= Date.now()
  const state = t.revokedAt ? 'revoked' : expired ? 'expired' : 'active'
  const expires = t.expiresAt ? new Date(t.expiresAt).toISOString() : '(never)'
  return [t.id, t.kind, state, t.label, `expires: ${expires}`, `last: ${last}`]
}

const createCmd = defineCommand({
  meta: { name: 'create', description: 'Mint a new device token with full access (shown once)' },
  args: {
    label: positional('Human-readable label'),
    'expires-days': {
      type: 'string',
      description: 'Expire the token after this many days (default: never)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const expiresInDays =
      args['expires-days'] === undefined ? undefined : Number(args['expires-days'])
    if (expiresInDays !== undefined && !(Number.isInteger(expiresInDays) && expiresInDays > 0)) {
      throw new Error('--expires-days must be a positive integer')
    }
    const body: CreateTokenRequest = { label: args.label, expiresInDays }
    const res = await client.post<CreateTokenResponse>('/api/tokens', body)
    console.log(`id:     ${res.meta.id}`)
    console.log(`label:  ${res.meta.label}`)
    console.log(`kind:   ${res.meta.kind}`)
    console.log(
      `expires: ${res.meta.expiresAt ? new Date(res.meta.expiresAt).toISOString() : '(never)'}`,
    )
    console.log(`token: ${res.token}`)
    console.log('')
    console.log('store the token now — it is not recoverable later.')
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List web tokens' },
  args: {
    all: { type: 'boolean', description: 'Include revoked tokens' },
  },
  async run({ args }) {
    const { tokens } = await createClient().get<ListTokensResponse>(
      `/api/tokens${args.all ? '?includeRevoked=1' : ''}`,
    )
    printRows(tokens.map(tokenRow), '(no tokens)')
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
  meta: { name: 'revoke', description: 'Revoke a web token and its browser sessions' },
  args: { id: positional('Token id') },
  async run({ args }) {
    await createClient().del(apiPath('tokens', args.id))
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
