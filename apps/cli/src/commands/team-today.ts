import type { TeamDayKind, TeamDayResponse } from '@bazilion/api-types'
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

// `bazilion team today`: what a Team's Agents handed to each other, delivered, worked on and wait
// on you for today, newest first: the same list as the Team's page in the web.

const KIND: Record<TeamDayKind, string> = {
  handoff: 'handed off',
  reply: 'replied',
  file: 'delivered',
  worked: 'worked in',
  question: 'asks you',
  approval: 'waits on you',
}

export const teamTodayCommand = defineCommand({
  meta: {
    name: 'today',
    description: "What a Team's Agents handed off, delivered, worked on and wait on you for today",
  },
  args: { id: teamArg, json: jsonFlag },
  async run({ args }) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const day = await createClient().get<TeamDayResponse>(
      `${apiPath('teams', args.id, 'today')}?since=${start.getTime()}`,
    )
    if (args.json) return printJson(day)
    printRows(
      day.events.map((event) => [
        new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        event.otherAgentName ? `${event.agentName} -> ${event.otherAgentName}` : event.agentName,
        KIND[event.kind],
        terminalSafe(event.text),
      ]),
      '(nothing yet today)',
    )
    if (day.truncated) console.log('note: only the latest events are listed')
  },
})
