import type { ActivityResponse, Agent, AgentActivity } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson, printRows, terminalSafe } from '../command-helpers.ts'

// `bazilion activity`: what every Agent is doing and what waits for you, as the web's rail shows it.

/** One line for an Agent's state; what needs the operator comes first. */
export function activityState(activity: AgentActivity): string {
  if (activity.questions > 0) {
    return `needs you: ${activity.questions} question${activity.questions === 1 ? '' : 's'}`
  }
  if (activity.approvals > 0) {
    return `needs you: ${activity.approvals} command${activity.approvals === 1 ? '' : 's'} to approve`
  }
  if (activity.working) {
    if (!activity.step) return 'working'
    return activity.step.target
      ? `working: ${activity.step.tool} ${activity.step.target}`
      : `working: ${activity.step.tool}`
  }
  if (activity.queuePaused) return 'follow-ups paused'
  return 'idle'
}

export const activityCommand = defineCommand({
  meta: {
    name: 'activity',
    description: 'Show what every Agent is doing and what waits for you',
  },
  args: {
    team: { type: 'string', description: 'Only Agents of this Team' },
    json: jsonFlag,
  },
  async run({ args }) {
    const client = createClient()
    const [activity, agents] = await Promise.all([
      client.get<ActivityResponse>('/api/activity'),
      client.get<Agent[]>('/api/agents'),
    ])
    const shown = activity.agents.filter((entry) => !args.team || entry.teamId === args.team)
    if (args.json) return printJson({ agents: shown })
    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    printRows(
      shown.map((entry) => [
        names.get(entry.agentId) ?? entry.agentId.slice(0, 8),
        entry.teamId,
        terminalSafe(activityState(entry)),
        entry.lastActivityAt ? new Date(entry.lastActivityAt).toISOString() : '',
        entry.results ? `${entry.results} file${entry.results === 1 ? '' : 's'}` : '',
      ]),
      '(no agents)',
    )
  },
})
