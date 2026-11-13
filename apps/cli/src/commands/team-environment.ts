import type { CodingEnvironmentStatus } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson, teamArg } from '../command-helpers.ts'

function print(status: CodingEnvironmentStatus): void {
  console.log(
    `sandbox: ${status.sandboxMode}${status.sandboxMode === 'off' ? ' (defaults unused)' : ''}`,
  )
  console.log(`image:   ${status.image ?? `${status.defaultImage} (installation default)`}`)
  console.log(`cwd:     ${status.cwd}`)
}

export const teamEnvironmentCommand = defineCommand({
  meta: {
    name: 'environment',
    description: "A Team's Docker sandbox defaults: local image and working directory",
  },
  subCommands: {
    show: defineCommand({
      meta: { name: 'show', description: "Show a Team's Docker sandbox defaults" },
      args: { team: teamArg, json: jsonFlag },
      async run({ args }) {
        const status = await createClient().codingEnvironment.show(args.team)
        if (args.json) printJson(status)
        else print(status)
      },
    }),
    set: defineCommand({
      meta: { name: 'set', description: "Set a Team's Docker sandbox defaults" },
      args: {
        team: teamArg,
        image: {
          type: 'string',
          description: 'Local Docker image (empty for the installation image)',
        },
        cwd: {
          type: 'string',
          description: "Working directory inside the Team ('.' for its root)",
        },
      },
      async run({ args }) {
        if (args.image === undefined && args.cwd === undefined)
          throw new Error('Pass --image and/or --cwd')
        const client = createClient()
        const current = await client.codingEnvironment.show(args.team)
        print(
          await client.codingEnvironment.set(args.team, {
            image: args.image === undefined ? current.image : args.image || null,
            cwd: args.cwd ?? current.cwd,
          }),
        )
      },
    }),
  },
})
