import type { ListSessionsResponse, WebSession } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'

function row(session: WebSession): string[] {
  const state = session.revokedAt
    ? 'revoked'
    : session.absoluteExpiresAt <= Date.now() || session.idleExpiresAt <= Date.now()
      ? 'expired'
      : 'active'
  return [
    session.id,
    state,
    session.current ? 'current' : '',
    session.deviceLabel,
    `idle: ${new Date(session.idleExpiresAt).toISOString()}`,
    `absolute: ${new Date(session.absoluteExpiresAt).toISOString()}`,
  ]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List browser sessions' },
  async run() {
    const { sessions } = await createClient().get<ListSessionsResponse>('/api/sessions')
    if (sessions.length === 0) {
      console.log('(no active browser sessions)')
      return
    }
    for (const line of columnize(sessions.map(row))) console.log(line)
  },
})

const revokeCmd = defineCommand({
  meta: { name: 'revoke', description: 'Revoke one browser session' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    await createClient().del(`/api/sessions/${encodeURIComponent(args.id)}`)
    console.log(`revoked browser session ${args.id}`)
  },
})

export const sessionCommand = defineCommand({
  meta: { name: 'session', description: 'Manage browser sessions' },
  subCommands: { list: listCmd, revoke: revokeCmd },
})
