import { readFileSync } from 'node:fs'
import { stdin } from 'node:process'
import type {
  RegisterTeamRequest,
  ResolvedTeamPolicy,
  SetTeamTopicFormatRequest,
  SetTeamUserMdRequest,
  Team,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { teamPolicyCommand } from './team-policy.ts'

const addCmd = defineCommand({
  meta: {
    name: 'add',
    description:
      'Register a team at ~/.bazilion/teams/<slug>/ (use --link to point at an existing tree)',
  },
  args: {
    id: { type: 'positional', required: true, description: 'Team slug' },
    name: { type: 'string', description: 'Display name (defaults to slug)' },
    link: {
      type: 'string',
      description: 'Absolute path of an existing directory; the team slot becomes a symlink to it',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: RegisterTeamRequest = {
      id: args.id,
      ...(args.name ? { name: args.name } : {}),
      ...(args.link ? { link: args.link } : {}),
    }
    const g = await client.post<Team>('/api/teams', body)
    console.log(`registered team ${g.id} at ${g.path}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List teams' },
  async run() {
    const client = createClient()
    const list = await client.get<Team[]>('/api/teams')
    if (list.length === 0) {
      console.log('(no teams)')
      return
    }
    const rows = list.map((g) => [g.id, g.path])
    for (const line of columnize(rows)) console.log(line)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a team registration' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const policy = await client.get<ResolvedTeamPolicy>(
      `/api/teams/${encodeURIComponent(args.id)}/policy`,
    )
    await client.del(
      `/api/teams/${encodeURIComponent(args.id)}?expectedTeamPolicyRevision=${policy.teamPolicy.revision}`,
    )
    console.log(`removed team ${args.id}`)
  },
})

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const userMdShowCmd = defineCommand({
  meta: { name: 'show', description: "Print the team's USER.md" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const g = await client.get<Team>(`/api/teams/${args.id}`)
    process.stdout.write(g.userMd)
    if (g.userMd && !g.userMd.endsWith('\n')) process.stdout.write('\n')
  },
})

const userMdSetCmd = defineCommand({
  meta: {
    name: 'set',
    description: "Replace the team's USER.md (from --file, --from-stdin, or inline text)",
  },
  args: {
    id: { type: 'positional', required: true },
    file: { type: 'string', description: 'Read content from a file path' },
    'from-stdin': { type: 'boolean', description: 'Read content from stdin' },
    text: { type: 'string', description: 'Inline content' },
  },
  async run({ args }) {
    let content: string
    if (args['from-stdin']) content = await readStdin()
    else if (args.file) content = readFileSync(args.file, 'utf8')
    else if (args.text !== undefined) content = args.text
    else {
      console.error('team user-md set: provide --file, --from-stdin, or --text')
      process.exit(2)
    }
    const client = createClient()
    const body: SetTeamUserMdRequest = { userMd: content }
    await client.put(`/api/teams/${args.id}/user-md`, body)
    console.log(`updated USER.md for team ${args.id} (${content.length} bytes)`)
  },
})

const userMdClearCmd = defineCommand({
  meta: { name: 'clear', description: "Clear the team's USER.md to empty" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const body: SetTeamUserMdRequest = { userMd: '' }
    await client.put(`/api/teams/${args.id}/user-md`, body)
    console.log(`cleared USER.md for team ${args.id}`)
  },
})

const userMdCmd = defineCommand({
  meta: { name: 'user-md', description: "View or edit a team's USER.md" },
  subCommands: {
    show: userMdShowCmd,
    set: userMdSetCmd,
    clear: userMdClearCmd,
  },
})

const topicFormatShowCmd = defineCommand({
  meta: { name: 'show', description: "Print the team's Telegram topic-name template" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const g = await client.get<Team>(`/api/teams/${args.id}`)
    console.log(g.telegramTopicNameFormat ?? '(default naming)')
  },
})

const topicFormatSetCmd = defineCommand({
  meta: {
    name: 'set',
    description:
      'Set the topic-name template. Tokens: {agent.name} {team.name} {team.slug} (must include {agent.name})',
  },
  args: {
    id: { type: 'positional', required: true },
    format: {
      type: 'positional',
      required: true,
      description: 'e.g. "{team.name} / {agent.name}"',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: SetTeamTopicFormatRequest = { format: args.format }
    const g = await client.put<Team>(`/api/teams/${args.id}/topic-format`, body)
    console.log(`set topic-name template for team ${args.id}: ${g.telegramTopicNameFormat}`)
  },
})

const topicFormatClearCmd = defineCommand({
  meta: { name: 'clear', description: 'Clear the template (revert to built-in naming)' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const body: SetTeamTopicFormatRequest = { format: null }
    await client.put(`/api/teams/${args.id}/topic-format`, body)
    console.log(`cleared topic-name template for team ${args.id}`)
  },
})

const topicFormatCmd = defineCommand({
  meta: {
    name: 'topic-format',
    description: "View or edit a team's Telegram forum-topic name template",
  },
  subCommands: {
    show: topicFormatShowCmd,
    set: topicFormatSetCmd,
    clear: topicFormatClearCmd,
  },
})

export const teamCommand = defineCommand({
  meta: { name: 'team', description: 'Manage teams (collaboration contexts)' },
  subCommands: {
    add: addCmd,
    list: listCmd,
    rm: rmCmd,
    'user-md': userMdCmd,
    'topic-format': topicFormatCmd,
    policy: teamPolicyCommand,
  },
})
