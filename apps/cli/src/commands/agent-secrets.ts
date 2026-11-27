// `bazilion agent secret`: an Agent's secrets (BAZ-090). Values are read without echo and never
// printed; setting one answers the Agent's request for it, if one is waiting.

import { readFileSync } from 'node:fs'
import type {
  AgentQuestionListResponse,
  ListAgentSecretsResponse,
  SetAgentSecretRequest,
  SetAgentSecretResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, askSecret, positional, printRows } from '../command-helpers.ts'

const nameArg = positional('Secret name, such as GITHUB_TOKEN')

const listCmd = defineCommand({
  meta: { name: 'list', description: "List an Agent's secrets (never their values)" },
  args: { agent: agentArg },
  async run({ args }) {
    const { secrets } = await createClient().get<ListAgentSecretsResponse>(
      apiPath('agents', args.agent, 'secrets'),
    )
    printRows(
      secrets.map((secret) => [
        secret.name,
        secret.hosts.length > 0 ? `web_fetch: ${secret.hosts.join(',')}` : 'commands only',
        `stored ${new Date(secret.storedAt).toISOString()}`,
        secret.reason ?? '',
      ]),
      '(no secrets)',
    )
  },
})

const setCmd = defineCommand({
  meta: {
    name: 'set',
    description: 'Store or replace a secret; the value is read without echo (or from --from-file)',
  },
  args: {
    agent: agentArg,
    name: nameArg,
    hosts: {
      type: 'string',
      description: 'Hosts web_fetch may send it to, comma-separated (api.github.com)',
    },
    reason: { type: 'string', description: 'What it is for' },
    'from-file': { type: 'string', description: 'Read the value from this file (a key file)' },
  },
  async run({ args }) {
    const client = createClient()
    // Hosts are the owner's to give: a request's are shown, and taken only with --hosts.
    const { questions } = await client.get<AgentQuestionListResponse>(
      apiPath('agents', args.agent, 'questions'),
    )
    const asked = questions.find((question) => question.question.secret?.name === args.name)
      ?.question.secret
    if (asked?.hosts?.length && args.hosts === undefined)
      console.log(
        `The Agent asked that web_fetch may send ${args.name} to ${asked.hosts.join(', ')}. That is not given unless you pass --hosts ${asked.hosts.join(',')}.`,
      )
    const file = args['from-file']
    const value =
      file !== undefined
        ? readFileSync(file, 'utf8')
        : await askSecret(`Value for ${args.name} (not shown): `)
    if (!value.trim()) throw new Error('no value given; nothing was stored')
    const body: SetAgentSecretRequest = {
      value,
      ...(args.hosts !== undefined
        ? {
            hosts: args.hosts
              .split(',')
              .map((host) => host.trim())
              .filter(Boolean),
          }
        : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    }
    const { secret } = await client.put<SetAgentSecretResponse>(
      apiPath('agents', args.agent, 'secrets', args.name),
      body,
    )
    console.log(
      `stored ${secret.name}${secret.hosts.length > 0 ? ` (web_fetch: ${secret.hosts.join(', ')})` : ''}`,
    )
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a secret' },
  args: { agent: agentArg, name: nameArg },
  async run({ args }) {
    await createClient().del(apiPath('agents', args.agent, 'secrets', args.name))
    console.log(`removed ${args.name}`)
  },
})

export const agentSecretCommand = defineCommand({
  meta: { name: 'secret', description: "An Agent's secrets: list, set (no echo), rm" },
  subCommands: { list: listCmd, set: setCmd, rm: rmCmd },
})
