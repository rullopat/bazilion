import { readFileSync } from 'node:fs'
import type { ConfigureCodingEnvironmentRequest } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const args = { id: { type: 'positional', required: true, description: 'Team slug' } } as const
export const teamEnvironmentCommand = defineCommand({
  meta: {
    name: 'environment',
    description: 'Optional Team runtime defaults; Agents discover and run commands during tasks',
  },
  subCommands: {
    show: defineCommand({
      args,
      async run({ args }) {
        console.log(JSON.stringify(await createClient().codingEnvironment.show(args.id), null, 2))
      },
    }),
    configure: defineCommand({
      args: {
        ...args,
        file: {
          type: 'string',
          required: true,
          description: 'JSON {expectedRevision,config:{image,cwd,env}}',
        },
      },
      async run({ args }) {
        const input = JSON.parse(
          readFileSync(args.file, 'utf8'),
        ) as ConfigureCodingEnvironmentRequest
        console.log(
          JSON.stringify(await createClient().codingEnvironment.configure(args.id, input), null, 2),
        )
      },
    }),
  },
})
