import type {
  Agent,
  MoveAgentRequest,
  ResolvedAgent,
  SetOrderRequest,
  SpawnAgentRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, printRows, teamArg } from '../command-helpers.ts'
import { UsageError } from '../errors.ts'
import { browserCommand } from './agent-browser.ts'
import { chatCommand } from './agent-chat.ts'
import { contextCommands } from './agent-context.ts'
import { agentHelpersCommand } from './agent-helpers.ts'
import { learningCommands } from './agent-learning.ts'
import { agentSecretCommand } from './agent-secrets.ts'
import { agentSkillCommand } from './agent-skills.ts'

const spawnCmd = defineCommand({
  meta: { name: 'spawn', description: 'Spawn an agent from a profile into a team' },
  args: {
    profile: { type: 'string', required: true, description: 'Profile id' },
    name: { type: 'string', description: 'Agent name (defaults to profile name)' },
    team: { type: 'string', description: "Team to join (defaults to 'default')" },
    model: { type: 'string', description: 'Override profile default model' },
    reasoning: {
      type: 'string',
      description: 'Reasoning level: off|minimal|low|medium|high|xhigh (default: medium)',
    },
    role: {
      type: 'string',
      description:
        'What it is for: it starts knowing its job, without the get-to-know questions of a first conversation',
    },
  },
  async run({ args }) {
    const body: SpawnAgentRequest = {
      profileId: args.profile,
      name: args.name,
      model: args.model,
      reasoningLevel: args.reasoning as SpawnAgentRequest['reasoningLevel'],
      teamId: args.team ?? 'default',
      ...(args.role ? { role: args.role } : {}),
    }
    const { agent } = await createClient().post<{ agent: Agent }>('/api/agents', body)
    console.log(`spawned agent ${agent.id} (${agent.name})`)
    console.log(`dir: ${agent.dir}`)
  },
})

const editCmd = defineCommand({
  meta: {
    name: 'edit',
    description: 'Edit agent settings (name, model override, reasoning level, telegram mirror)',
  },
  args: {
    id: agentArg,
    name: { type: 'string', description: 'Rename the agent' },
    model: { type: 'string', description: 'Set model override (use --model "" to clear)' },
    reasoning: {
      type: 'string',
      description: 'Reasoning level: off|minimal|low|medium|high|xhigh',
    },
    mirror: { type: 'string', description: 'Telegram mirror verbosity: minimal|verbose' },
    'topic-icon': {
      type: 'string',
      description: 'Telegram topic emoji (e.g. 📚). Use --topic-icon "" to clear.',
    },
  },
  async run({ args }) {
    const body: Record<string, unknown> = {}
    if (args.name !== undefined) body.name = args.name
    if (args.model !== undefined) body.modelOverride = args.model === '' ? null : args.model
    if (args.reasoning !== undefined) body.reasoningLevel = args.reasoning
    if (args.mirror !== undefined) {
      if (args.mirror !== 'minimal' && args.mirror !== 'verbose') {
        throw new UsageError("--mirror must be 'minimal' or 'verbose'")
      }
      body.telegramMirrorMode = args.mirror
    }
    if (args['topic-icon'] !== undefined) {
      body.telegramIconEmoji = args['topic-icon'] === '' ? null : args['topic-icon']
    }
    if (Object.keys(body).length === 0) {
      throw new UsageError(
        'specify at least one of --name, --model, --reasoning, --mirror, --topic-icon',
      )
    }
    const agent = await createClient().patch<Agent>(apiPath('agents', args.id), body)
    console.log(`updated agent ${agent.id} (${agent.name})`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List agents' },
  args: {
    all: { type: 'boolean', description: 'Include archived agents' },
    long: { type: 'boolean', alias: 'l', description: 'Show profile + full UUID columns' },
  },
  async run({ args }) {
    const list = await createClient().get<Agent[]>(
      `/api/agents${args.all ? '?includeArchived=true' : ''}`,
    )
    printRows(
      list.map((a) =>
        // Every command accepts an id prefix, so the short listing shows the first 8 characters.
        args.long ? [a.id, a.status, a.name, a.profileId] : [a.id.slice(0, 8), a.status, a.name],
      ),
      '(no agents)',
    )
  },
})

const showCmd = defineCommand({
  meta: { name: 'show', description: 'Show agent details' },
  args: { id: agentArg },
  async run({ args }) {
    const r = await createClient().get<ResolvedAgent>(apiPath('agents', args.id))
    console.log(`# ${r.agent.id}`)
    console.log(`name:    ${r.agent.name}`)
    console.log(`status:  ${r.agent.status}`)
    console.log(`profile: ${r.profile.id}`)
    console.log(`model:   ${r.model}`)
    console.log(`dir:     ${r.agent.dir}`)
    console.log(`team:   ${r.team.id} ${r.team.path}`)
    console.log('skills:')
    if (r.skills.length === 0) console.log('  (none)')
    for (const s of r.skills) console.log(`  ${s}`)
  },
})

const archiveCmd = defineCommand({
  meta: { name: 'archive', description: 'Archive an agent' },
  args: { id: agentArg },
  async run({ args }) {
    await createClient().post(apiPath('agents', args.id, 'archive'))
    console.log(`archived agent ${args.id}`)
  },
})

const unarchiveCmd = defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived agent to idle' },
  args: { id: agentArg },
  async run({ args }) {
    await createClient().post(apiPath('agents', args.id, 'unarchive'))
    console.log(`unarchived agent ${args.id}`)
  },
})

const deleteCmd = defineCommand({
  meta: { name: 'delete', description: 'Permanently delete an agent and its data' },
  args: { id: agentArg },
  async run({ args }) {
    await createClient().del(apiPath('agents', args.id))
    console.log(`deleted agent ${args.id}`)
  },
})

const cancelCmd = defineCommand({
  meta: {
    name: 'cancel',
    description: "Abort the agent's running turn; waiting follow-ups are paused",
  },
  args: { id: agentArg },
  async run({ args }) {
    const { cancelled, queuePaused } = await createClient().post<{
      cancelled: boolean
      queuePaused: boolean
    }>(apiPath('agents', args.id, 'cancel'))
    if (cancelled) console.log(`cancelled active turn for ${args.id}`)
    if (queuePaused) {
      console.log(`follow-up queue paused; resume it with: bazilion queue resume ${args.id}`)
    }
  },
})

const orderCmd = defineCommand({
  meta: {
    name: 'order',
    description:
      "Set the order of a Team's Agents: those named come first, the others keep their order after them",
  },
  args: {
    team: teamArg,
    agent: { type: 'positional', description: 'Agent names or ids, in order', required: true },
  },
  async run({ args }) {
    // The first positional is the Team; the rest are its Agents, in order.
    const ids = args._.slice(1).map(String)
    const body: SetOrderRequest = { ids }
    const agents = await createClient().put<Agent[]>(
      apiPath('teams', args.team, 'agents', 'order'),
      body,
    )
    printRows(
      agents.map((agent, index) => [String(index + 1), agent.id.slice(0, 8), agent.name]),
      '(no agents)',
    )
  },
})

const moveCmd = defineCommand({
  meta: { name: 'move', description: 'Move an agent to a different team' },
  args: { agent: agentArg, team: teamArg },
  async run({ args }) {
    const body: MoveAgentRequest = { teamId: args.team }
    await createClient().patch(apiPath('agents', args.agent, 'team'), body)
    console.log(`moved ${args.agent} to team ${args.team}`)
  },
})

export const agentCommand = defineCommand({
  meta: { name: 'agent', description: 'Manage agent instances' },
  subCommands: {
    spawn: spawnCmd,
    list: listCmd,
    show: showCmd,
    edit: editCmd,
    archive: archiveCmd,
    unarchive: unarchiveCmd,
    delete: deleteCmd,
    chat: chatCommand,
    ...contextCommands,
    cancel: cancelCmd,
    ...learningCommands,
    skill: agentSkillCommand,
    move: moveCmd,
    order: orderCmd,
    browser: browserCommand,
    secret: agentSecretCommand,
    helpers: agentHelpersCommand,
  },
})
