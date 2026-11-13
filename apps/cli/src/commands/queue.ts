import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, loadAttachments, positional, printJson } from '../command-helpers.ts'

const itemArg = positional('Follow-up id')

const list = defineCommand({
  meta: {
    name: 'list',
    description: 'Show waiting, running and failed follow-ups, and whether a turn is running',
  },
  args: { agent: agentArg },
  async run({ args }) {
    printJson(await createClient().queue(args.agent).list())
  },
})

const add = defineCommand({
  meta: { name: 'add', description: 'Queue a follow-up; it runs after the current turn' },
  args: {
    agent: agentArg,
    message: { type: 'string', description: 'Text of the follow-up' },
    image: { type: 'string', description: 'Attach an image (repeatable)' },
    file: { type: 'string', description: 'Attach a file (repeatable)' },
  },
  async run({ args, rawArgs }) {
    printJson(
      await createClient()
        .queue(args.agent)
        .enqueue({ message: args.message ?? '', attachments: loadAttachments(rawArgs) }),
    )
  },
})

const edit = defineCommand({
  meta: { name: 'edit', description: 'Replace the text of a waiting follow-up' },
  args: {
    agent: agentArg,
    id: itemArg,
    message: { type: 'string', required: true, description: 'New text of the follow-up' },
  },
  async run({ args }) {
    printJson(await createClient().queue(args.agent).edit(args.id, args.message))
  },
})

const remove = defineCommand({
  meta: { name: 'remove', description: 'Remove a follow-up that is not running' },
  args: { agent: agentArg, id: itemArg },
  async run({ args }) {
    printJson(await createClient().queue(args.agent).remove(args.id))
  },
})

function control(paused: boolean) {
  return defineCommand({
    meta: {
      name: paused ? 'pause' : 'resume',
      description: paused ? 'Start no further follow-ups' : 'Start waiting follow-ups again',
    },
    args: { agent: agentArg },
    async run({ args }) {
      printJson(await createClient().queue(args.agent).pause(paused))
    },
  })
}

export const queueCommand = defineCommand({
  meta: { name: 'queue', description: 'Follow-ups: input that waits for the Agent’s current turn' },
  subCommands: { list, add, edit, remove, pause: control(true), resume: control(false) },
})
