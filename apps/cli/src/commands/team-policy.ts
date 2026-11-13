import {
  OUTSIDE_TEAM,
  type TeamPolicy,
  type TeamPolicyMode,
  type UpdateTeamPolicyRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { apiPath, jsonFlag, positional, printJson, teamArg } from '../command-helpers.ts'

function label(policy: TeamPolicy, endpoint: string): string {
  if (endpoint === OUTSIDE_TEAM) return 'outside'
  return policy.members.find((agent) => agent.id === endpoint)?.name ?? endpoint
}

/** `outside`, or a member's id, id prefix or name. */
function resolveEndpoint(policy: TeamPolicy, value: string): string {
  if (value === OUTSIDE_TEAM) return OUTSIDE_TEAM
  const byId = policy.members.find((agent) => agent.id === value)
  if (byId) return byId.id
  for (const matches of [
    policy.members.filter((agent) => agent.name === value),
    policy.members.filter((agent) => agent.id.startsWith(value)),
  ]) {
    if (matches.length > 1) throw new Error(`${value} matches several members of ${policy.teamId}`)
    if (matches[0]) return matches[0].id
  }
  throw new Error(`${value} is not a member of Team ${policy.teamId} (or outside)`)
}

const show = defineCommand({
  meta: { name: 'show', description: "Show a Team's policy mode, members and allow edges" },
  args: { team: teamArg, json: jsonFlag },
  async run({ args }) {
    const policy = await createClient().get<TeamPolicy>(apiPath('teams', args.team, 'policy'))
    if (args.json) return printJson(policy)
    console.log(`# Team ${policy.teamId} policy`)
    console.log(
      `mode:    ${policy.mode}${policy.mode === 'open' ? ' (members message each other freely)' : ' (members need an allow edge)'}`,
    )
    console.log(`members: ${policy.members.map((agent) => agent.name).join(', ') || '(none)'}`)
    if (!policy.edges.length) return console.log('edges:   (none)')
    console.log('')
    for (const line of columnize([
      ['from', 'to'],
      ...policy.edges.map((edge) => [label(policy, edge.from), label(policy, edge.to)]),
    ]))
      console.log(line)
  },
})

const mode = defineCommand({
  meta: {
    name: 'mode',
    description: 'Set a Team to open (members talk freely) or restricted (allow edges only)',
  },
  args: { team: teamArg, mode: positional('open | restricted') },
  async run({ args }) {
    if (args.mode !== 'open' && args.mode !== 'restricted') {
      throw new Error('mode must be open or restricted')
    }
    const body: UpdateTeamPolicyRequest = { mode: args.mode as TeamPolicyMode }
    await createClient().patch(apiPath('teams', args.team, 'policy'), body)
    console.log(`Team ${args.team} is now ${args.mode}`)
  },
})

function edgeCommand(name: 'allow' | 'deny') {
  return defineCommand({
    meta: {
      name,
      description:
        name === 'allow'
          ? 'Let one endpoint message another (a member name or id, or outside)'
          : 'Remove an allow edge',
    },
    args: {
      team: teamArg,
      from: positional('Sender: member or outside'),
      to: positional('Recipient: member or outside'),
    },
    async run({ args }) {
      const client = createClient()
      const policy = await client.get<TeamPolicy>(apiPath('teams', args.team, 'policy'))
      const edge = {
        from: resolveEndpoint(policy, args.from),
        to: resolveEndpoint(policy, args.to),
      }
      const shown = `${label(policy, edge.from)} -> ${label(policy, edge.to)}`
      const others = policy.edges.filter((e) => e.from !== edge.from || e.to !== edge.to)
      const exists = others.length < policy.edges.length
      if (name === 'allow' && exists) return console.log(`${shown} is already allowed`)
      if (name === 'deny' && !exists) return console.log(`no edge ${shown}; nothing changed`)
      const body: UpdateTeamPolicyRequest = {
        edges: name === 'allow' ? [...others, edge] : others,
      }
      await client.patch(apiPath('teams', args.team, 'policy'), body)
      console.log(`${name === 'allow' ? 'allowed' : 'removed'} ${shown}`)
    },
  })
}

export const teamPolicyCommand = defineCommand({
  meta: { name: 'policy', description: 'Who may message whom inside and across a Team' },
  subCommands: {
    show,
    mode,
    allow: edgeCommand('allow'),
    deny: edgeCommand('deny'),
  },
})
