import type { Agent, ListTeamMessagesResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import {
  apiPath,
  jsonFlag,
  printJson,
  printRows,
  teamArg,
  terminalSafe,
} from '../command-helpers.ts'

// `bazilion team messages`: what the Team's Agents sent each other, newest first. Reading here
// marks nothing read; `bazilion inbox` is one Agent's mailbox.

function decodeText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text
  } catch {
    // Not JSON: shown as it is.
  }
  return payload
}

export const teamMessagesCommand = defineCommand({
  meta: {
    name: 'messages',
    description: 'List the messages the Agents of a Team sent and received, newest first',
  },
  args: {
    id: teamArg,
    limit: { type: 'string', default: '50', description: 'Messages to show (at most 500)' },
    json: jsonFlag,
  },
  async run({ args }) {
    const client = createClient()
    const [thread, agents] = await Promise.all([
      client.get<ListTeamMessagesResponse>(
        `${apiPath('teams', args.id, 'messages')}?limit=${encodeURIComponent(args.limit)}`,
      ),
      client.get<Agent[]>('/api/agents?includeArchived=true'),
    ])
    if (args.json) return printJson(thread)
    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    const name = (id: string) => names.get(id) ?? id.slice(0, 8)
    printRows(
      thread.messages.map((message) => {
        const text = decodeText(message.payload).replace(/\s+/g, ' ').trim()
        return [
          new Date(message.createdAt).toISOString(),
          `${name(message.fromAgentId)} -> ${name(message.toAgentId)}`,
          message.readAt ? 'read' : 'NEW',
          terminalSafe(text.length > 80 ? `${text.slice(0, 80)}…` : text),
        ]
      }),
      '(no messages between Agents yet)',
    )
  },
})
