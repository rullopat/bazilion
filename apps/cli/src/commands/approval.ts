import type { ListCommandRulesResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { apiPath, positional, printRows } from '../command-helpers.ts'

const rulesCmd = defineCommand({
  meta: {
    name: 'rules',
    description: 'List the commands Agents may run without asking (kept with "always")',
  },
  args: { agent: { type: 'string', description: 'Only this Agent’s rules (its id)' } },
  async run({ args }) {
    const query = args.agent ? `?agentId=${encodeURIComponent(args.agent)}` : ''
    const { rules } = await createClient().get<ListCommandRulesResponse>(
      `/api/command-rules${query}`,
    )
    printRows(
      rules.map((rule) => [
        rule.id,
        rule.agentId,
        new Date(rule.createdAt).toISOString(),
        rule.prefix,
      ]),
      '(no rules)',
    )
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Remove a rule: its commands ask again' },
  args: { id: positional('Rule id') },
  async run({ args }) {
    await createClient().del(apiPath('command-rules', args.id))
    console.log(`removed rule ${args.id}`)
  },
})

export const approvalCommand = defineCommand({
  meta: { name: 'approval', description: 'Commands Agents may run without asking' },
  subCommands: { rules: rulesCmd, rm: rmCmd },
})
