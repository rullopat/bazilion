import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, ask, printJson } from '../command-helpers.ts'

const statusCmd = defineCommand({
  meta: { name: 'status', description: "Show the agent's browser status (never starts it)" },
  args: { id: agentArg },
  async run({ args }) {
    printJson(await createClient().getAgentBrowser(args.id))
  },
})

const stopCmd = defineCommand({
  meta: { name: 'stop', description: "Stop the agent's browser (the profile is kept)" },
  args: { id: agentArg },
  async run({ args }) {
    await createClient().stopAgentBrowser(args.id)
    console.log(`stopped the browser of agent ${args.id} (profile kept)`)
  },
})

const resetCmd = defineCommand({
  meta: {
    name: 'reset',
    description: "Stop the agent's browser and DELETE its profile (cookies, logins)",
  },
  args: {
    id: agentArg,
    yes: { type: 'boolean', description: 'Skip the confirmation prompt' },
  },
  async run({ args }) {
    if (!args.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('refusing to reset a browser profile noninteractively without --yes')
      }
      const answer = await ask(
        `This deletes the browser profile of ${args.id} (cookies, logins). Type the agent id to confirm: `,
      )
      if (answer !== args.id) throw new Error('confirmation did not match; nothing was changed')
    }
    await createClient().resetAgentBrowser(args.id)
    console.log(`reset the browser of agent ${args.id}: stopped, profile removed`)
  },
})

export const browserCommand = defineCommand({
  meta: { name: 'browser', description: "The agent's managed browser: status, stop, reset" },
  subCommands: { status: statusCmd, stop: stopCmd, reset: resetCmd },
})
