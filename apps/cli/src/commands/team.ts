import { readFileSync } from 'node:fs'
import { stdin } from 'node:process'
import type {
  RegisterTeamRequest,
  SetTeamTopicFormatRequest,
  SetTeamUserMdRequest,
  Team,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, printRows, teamArg } from '../command-helpers.ts'
import { UsageError } from '../errors.ts'
import { teamEnvironmentCommand } from './team-environment.ts'
import { teamPolicyCommand } from './team-policy.ts'
import { teamReviewCommand } from './team-review.ts'

const addCmd = defineCommand({
  meta: {
    name: 'add',
    description:
      'Register a team at ~/.bazilion/teams/<slug>/ (use --link to point at an existing tree)',
  },
  args: {
    id: teamArg,
    name: { type: 'string', description: 'Display name (defaults to slug)' },
    link: {
      type: 'string',
      description: 'Absolute path of an existing directory; the team slot becomes a symlink to it',
    },
  },
  async run({ args }) {
    const body: RegisterTeamRequest = {
      id: args.id,
      ...(args.name ? { name: args.name } : {}),
      ...(args.link ? { link: args.link } : {}),
    }
    const team = await createClient().post<Team>('/api/teams', body)
    console.log(`registered team ${team.id} at ${team.path}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List teams' },
  async run() {
    const list = await createClient().get<Team[]>('/api/teams')
    printRows(
      list.map((team) => [team.id, team.path]),
      '(no teams)',
    )
  },
})

const rmCmd = defineCommand({
  meta: {
    name: 'rm',
    description: 'Delete an empty team and its workspace directory (a --link target is kept)',
  },
  args: { id: teamArg },
  async run({ args }) {
    await createClient().del(apiPath('teams', args.id))
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
  args: { id: teamArg },
  async run({ args }) {
    const team = await createClient().get<Team>(apiPath('teams', args.id))
    process.stdout.write(team.userMd)
    if (team.userMd && !team.userMd.endsWith('\n')) process.stdout.write('\n')
  },
})

const userMdSetCmd = defineCommand({
  meta: {
    name: 'set',
    description: "Replace the team's USER.md (from --file, --from-stdin, or inline text)",
  },
  args: {
    id: teamArg,
    file: { type: 'string', description: 'Read content from a file path' },
    'from-stdin': { type: 'boolean', description: 'Read content from stdin' },
    text: { type: 'string', description: 'Inline content' },
  },
  async run({ args }) {
    let content: string
    if (args['from-stdin']) content = await readStdin()
    else if (args.file) content = readFileSync(args.file, 'utf8')
    else if (args.text !== undefined) content = args.text
    else throw new UsageError('provide --file, --from-stdin, or --text')
    const body: SetTeamUserMdRequest = { userMd: content }
    await createClient().put(apiPath('teams', args.id, 'user-md'), body)
    console.log(`updated USER.md for team ${args.id} (${content.length} bytes)`)
  },
})

const userMdClearCmd = defineCommand({
  meta: { name: 'clear', description: "Clear the team's USER.md to empty" },
  args: { id: teamArg },
  async run({ args }) {
    const body: SetTeamUserMdRequest = { userMd: '' }
    await createClient().put(apiPath('teams', args.id, 'user-md'), body)
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
  args: { id: teamArg },
  async run({ args }) {
    const team = await createClient().get<Team>(apiPath('teams', args.id))
    console.log(team.telegramTopicNameFormat ?? '(default naming)')
  },
})

const topicFormatSetCmd = defineCommand({
  meta: {
    name: 'set',
    description:
      'Set the topic-name template. Tokens: {agent.name} {team.name} {team.slug} (must include {agent.name})',
  },
  args: {
    id: teamArg,
    format: {
      type: 'positional',
      required: true,
      description: 'e.g. "{team.name} / {agent.name}"',
    },
  },
  async run({ args }) {
    const body: SetTeamTopicFormatRequest = { format: args.format }
    const team = await createClient().put<Team>(apiPath('teams', args.id, 'topic-format'), body)
    console.log(`set topic-name template for team ${args.id}: ${team.telegramTopicNameFormat}`)
  },
})

const topicFormatClearCmd = defineCommand({
  meta: { name: 'clear', description: 'Clear the template (revert to built-in naming)' },
  args: { id: teamArg },
  async run({ args }) {
    const body: SetTeamTopicFormatRequest = { format: null }
    await createClient().put(apiPath('teams', args.id, 'topic-format'), body)
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
    environment: teamEnvironmentCommand,
    review: teamReviewCommand,
    add: addCmd,
    list: listCmd,
    rm: rmCmd,
    'user-md': userMdCmd,
    'topic-format': topicFormatCmd,
    policy: teamPolicyCommand,
  },
})
