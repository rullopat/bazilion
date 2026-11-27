// `bazilion agent helpers <agent>`: the Agent's helpers (BAZ-092), running first, and --stop.

import type { ListHelpersResponse, StopHelperResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, printRows } from '../command-helpers.ts'

export const agentHelpersCommand = defineCommand({
  meta: { name: 'helpers', description: "List an Agent's helpers, or stop them with --stop" },
  args: {
    agent: agentArg,
    stop: { type: 'string', description: 'Stop this helper, or all of them with "all"' },
  },
  async run({ args }) {
    const client = createClient()
    const { helpers } = await client.get<ListHelpersResponse>(
      apiPath('agents', args.agent, 'helpers'),
    )
    if (args.stop !== undefined) {
      const ids =
        args.stop === 'all'
          ? helpers.filter((helper) => helper.status === 'running').map((helper) => helper.id)
          : [args.stop]
      if (ids.length === 0) return console.log('no helper is running')
      for (const id of ids) {
        const { helper } = await client.post<StopHelperResponse>(
          apiPath('agents', args.agent, 'helpers', id, 'stop'),
        )
        console.log(`${helper.id}\t${helper.status}`)
      }
      return
    }
    printRows(
      helpers.map((helper) => [
        helper.id,
        helper.status === 'running' ? `running: ${helper.activity}` : helper.status,
        helper.model ?? '',
        `started ${new Date(helper.startedAt).toISOString()}`,
        helper.task.split('\n')[0]?.slice(0, 80) ?? '',
      ]),
      '(no helpers since the daemon started)',
    )
  },
})
