import type { ListSessionsResponse, WebSession } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, printRows } from '../command-helpers.ts'

function row(session: WebSession): string[] {
  return [
    session.id,
    session.current ? 'current' : '',
    session.tokenLabel,
    `last seen: ${new Date(session.lastSeenAt).toISOString()}`,
    `expires: ${new Date(session.expiresAt).toISOString()}`,
  ]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List browser sessions' },
  async run() {
    const { sessions } = await createClient().get<ListSessionsResponse>('/api/sessions')
    printRows(sessions.map(row), '(no active browser sessions)')
  },
})

const revokeCmd = defineCommand({
  meta: { name: 'revoke', description: 'Revoke (delete) one browser session' },
  args: { id: positional('Session id') },
  async run({ args }) {
    await createClient().del(apiPath('sessions', args.id))
    console.log(`revoked browser session ${args.id}`)
  },
})

export const sessionCommand = defineCommand({
  meta: { name: 'session', description: 'Manage browser sessions' },
  subCommands: { list: listCmd, revoke: revokeCmd },
})
