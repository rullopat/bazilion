import { WORKSPACE_RECOVERY_OUTCOME_TEXT, workspaceRecoveryExplanation } from '@bazilion/client'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

export const teamRecoveryCommand = defineCommand({
  meta: {
    name: 'recovery',
    description: 'Inspect and attempt daemon-owned workspace recovery (never force-clear)',
  },
  subCommands: {
    list: defineCommand({
      args: {
        team: { type: 'positional', required: true },
        json: { type: 'boolean', default: false },
      },
      async run({ args }) {
        const report = await createClient().workspaceRecovery(args.team).list()
        if (args.json) {
          console.log(JSON.stringify(report))
          return
        }
        for (const writer of report.writers) {
          console.log(`${writer.writerId}\t${writer.posture}`)
          console.log(`  ${workspaceRecoveryExplanation(writer)}`)
        }
        if (!report.writers.length)
          console.log('No recorded writers. This is not a workspace verification.')
        if (report.truncated) console.log('Report truncated.')
      },
    }),
    attempt: defineCommand({
      args: {
        team: { type: 'positional', required: true },
        writer: { type: 'positional', required: true },
        json: { type: 'boolean', default: false },
      },
      async run({ args }) {
        const result = await createClient().workspaceRecovery(args.team).attempt(args.writer)
        console.log(
          args.json
            ? JSON.stringify(result)
            : `${result.outcome}: ${WORKSPACE_RECOVERY_OUTCOME_TEXT[result.outcome]}`,
        )
        if (result.outcome !== 'recovered') process.exitCode = 1
      },
    }),
  },
})
