import type {
  AgentTrigger,
  CreateTriggerRequest,
  CreateTriggerResponse,
  ListTriggerDispatchesResponse,
  ListTriggersResponse,
  UpdateTriggerRequest,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows } from '../command-helpers.ts'

const triggerArg = positional('Trigger id')

function spec(t: AgentTrigger): string {
  return t.kind === 'interval' ? `every ${t.intervalSec}s` : `cron "${t.cronExpr}"`
}

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Add an interval / cron trigger to an agent' },
  args: {
    agent: agentArg,
    every: {
      type: 'string',
      description: 'Interval in seconds (e.g. --every 300 = every 5 minutes)',
    },
    cron: {
      type: 'string',
      description: 'Cron expression (5 fields: minute hour dom month dow)',
    },
    message: {
      type: 'string',
      required: true,
      description: 'Message to inject when the trigger fires',
    },
    disabled: { type: 'boolean', description: 'Create in disabled state' },
  },
  async run({ args }) {
    if (!args.every === !args.cron) {
      throw new Error('specify exactly one of --every <seconds> or --cron "<expr>"')
    }
    const body: CreateTriggerRequest = args.every
      ? {
          kind: 'interval',
          intervalSec: Number(args.every),
          message: args.message,
          enabled: !args.disabled,
        }
      : {
          kind: 'cron',
          cronExpr: args.cron as string,
          message: args.message,
          enabled: !args.disabled,
        }
    const { trigger } = await createClient().post<CreateTriggerResponse>(
      apiPath('agents', args.agent, 'triggers'),
      body,
    )
    console.log(`${trigger.id}\t${spec(trigger)}\t${trigger.enabled ? 'enabled' : 'disabled'}`)
  },
})

function triggerRow(t: AgentTrigger): string[] {
  const last = t.lastFiredAt ? new Date(t.lastFiredAt).toISOString() : '(never)'
  const state = t.enabled ? 'enabled' : 'disabled'
  const msgPreview = t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message
  return [t.id, state, spec(t), `last: ${last}`, `"${msgPreview}"`]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List triggers for an agent' },
  args: { agent: agentArg },
  async run({ args }) {
    const { triggers } = await createClient().get<ListTriggersResponse>(
      apiPath('agents', args.agent, 'triggers'),
    )
    printRows(triggers.map(triggerRow), '(no triggers)')
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Delete a trigger' },
  args: { id: triggerArg },
  async run({ args }) {
    await createClient().del(apiPath('triggers', args.id))
    console.log(`removed trigger ${args.id}`)
  },
})

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Enable a trigger' },
  args: { id: triggerArg },
  async run({ args }) {
    const body: UpdateTriggerRequest = { enabled: true }
    await createClient().patch(apiPath('triggers', args.id), body)
    console.log(`enabled trigger ${args.id}`)
  },
})

const disableCmd = defineCommand({
  meta: { name: 'disable', description: 'Disable a trigger' },
  args: { id: triggerArg },
  async run({ args }) {
    const body: UpdateTriggerRequest = { enabled: false }
    await createClient().patch(apiPath('triggers', args.id), body)
    console.log(`disabled trigger ${args.id}`)
  },
})

const historyCmd = defineCommand({
  meta: { name: 'history', description: 'Show recent runs of a trigger' },
  args: {
    id: triggerArg,
    limit: { type: 'string', description: 'Maximum rows (default 20)' },
  },
  async run({ args }) {
    const limit = args.limit ? Number(args.limit) : 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('--limit must be an integer from 1 to 100')
    }
    const { dispatches } = await createClient().get<ListTriggerDispatchesResponse>(
      `${apiPath('triggers', args.id, 'dispatches')}?limit=${limit}`,
    )
    printRows(
      dispatches.map((dispatch) => [
        new Date(dispatch.scheduledAt).toISOString(),
        dispatch.status,
        dispatch.error ?? '',
      ]),
      '(no dispatches)',
    )
  },
})

export const triggerCommand = defineCommand({
  meta: { name: 'trigger', description: 'Manage scheduled agent triggers' },
  subCommands: {
    add: addCmd,
    list: listCmd,
    rm: rmCmd,
    enable: enableCmd,
    disable: disableCmd,
    history: historyCmd,
  },
})
