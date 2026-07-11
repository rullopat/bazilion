import { readFileSync } from 'node:fs'
import { stdin } from 'node:process'
import type {
  Group,
  RegisterGroupRequest,
  SetGroupTopicFormatRequest,
  SetGroupUserMdRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { columnize } from '../columnize.ts'
import { groupPolicyCommand } from './group-policy.ts'

const addCmd = defineCommand({
  meta: {
    name: 'add',
    description:
      'Register a group at ~/.bazilion/groups/<slug>/ (use --link to point at an existing tree)',
  },
  args: {
    id: { type: 'positional', required: true, description: 'Group slug' },
    name: { type: 'string', description: 'Display name (defaults to slug)' },
    link: {
      type: 'string',
      description: 'Absolute path of an existing directory; the group slot becomes a symlink to it',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: RegisterGroupRequest = {
      id: args.id,
      ...(args.name ? { name: args.name } : {}),
      ...(args.link ? { link: args.link } : {}),
    }
    const g = await client.post<Group>('/api/groups', body)
    console.log(`registered group ${g.id} at ${g.path}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List groups' },
  async run() {
    const client = createClient()
    const list = await client.get<Group[]>('/api/groups')
    if (list.length === 0) {
      console.log('(no groups)')
      return
    }
    const rows = list.map((g) => [g.id, g.path])
    for (const line of columnize(rows)) console.log(line)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a group registration' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/groups/${args.id}`)
    console.log(`removed group ${args.id}`)
  },
})

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const userMdShowCmd = defineCommand({
  meta: { name: 'show', description: "Print the group's USER.md" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const g = await client.get<Group>(`/api/groups/${args.id}`)
    process.stdout.write(g.userMd)
    if (g.userMd && !g.userMd.endsWith('\n')) process.stdout.write('\n')
  },
})

const userMdSetCmd = defineCommand({
  meta: {
    name: 'set',
    description: "Replace the group's USER.md (from --file, --from-stdin, or inline text)",
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
      console.error('group user-md set: provide --file, --from-stdin, or --text')
      process.exit(2)
    }
    const client = createClient()
    const body: SetGroupUserMdRequest = { userMd: content }
    await client.put(`/api/groups/${args.id}/user-md`, body)
    console.log(`updated USER.md for group ${args.id} (${content.length} bytes)`)
  },
})

const userMdClearCmd = defineCommand({
  meta: { name: 'clear', description: "Clear the group's USER.md to empty" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const body: SetGroupUserMdRequest = { userMd: '' }
    await client.put(`/api/groups/${args.id}/user-md`, body)
    console.log(`cleared USER.md for group ${args.id}`)
  },
})

const userMdCmd = defineCommand({
  meta: { name: 'user-md', description: "View or edit a group's USER.md" },
  subCommands: {
    show: userMdShowCmd,
    set: userMdSetCmd,
    clear: userMdClearCmd,
  },
})

const topicFormatShowCmd = defineCommand({
  meta: { name: 'show', description: "Print the group's Telegram topic-name template" },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const g = await client.get<Group>(`/api/groups/${args.id}`)
    console.log(g.telegramTopicNameFormat ?? '(default naming)')
  },
})

const topicFormatSetCmd = defineCommand({
  meta: {
    name: 'set',
    description:
      'Set the topic-name template. Tokens: {agent.name} {group.name} {group.slug} (must include {agent.name})',
  },
  args: {
    id: { type: 'positional', required: true },
    format: {
      type: 'positional',
      required: true,
      description: 'e.g. "{group.name} / {agent.name}"',
    },
  },
  async run({ args }) {
    const client = createClient()
    const body: SetGroupTopicFormatRequest = { format: args.format }
    const g = await client.put<Group>(`/api/groups/${args.id}/topic-format`, body)
    console.log(`set topic-name template for group ${args.id}: ${g.telegramTopicNameFormat}`)
  },
})

const topicFormatClearCmd = defineCommand({
  meta: { name: 'clear', description: 'Clear the template (revert to built-in naming)' },
  args: { id: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    const body: SetGroupTopicFormatRequest = { format: null }
    await client.put(`/api/groups/${args.id}/topic-format`, body)
    console.log(`cleared topic-name template for group ${args.id}`)
  },
})

const topicFormatCmd = defineCommand({
  meta: {
    name: 'topic-format',
    description: "View or edit a group's Telegram forum-topic name template",
  },
  subCommands: {
    show: topicFormatShowCmd,
    set: topicFormatSetCmd,
    clear: topicFormatClearCmd,
  },
})

export const groupCommand = defineCommand({
  meta: { name: 'group', description: 'Manage groups (collaboration contexts)' },
  subCommands: {
    add: addCmd,
    list: listCmd,
    rm: rmCmd,
    'user-md': userMdCmd,
    'topic-format': topicFormatCmd,
    policy: groupPolicyCommand,
  },
})
