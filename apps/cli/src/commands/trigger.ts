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
import { columnize } from '../columnize.ts'

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Add an interval / cron trigger to an agent' },
  args: {
    agent: { type: 'positional', required: true },
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
    const client = createClient()
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
    const res = await client.post<CreateTriggerResponse>(`/api/agents/${args.agent}/triggers`, body)
    const t = res.trigger
    const spec = t.kind === 'interval' ? `every ${t.intervalSec}s` : `cron "${t.cronExpr}"`
    console.log(`${t.id}\t${spec}\t${t.enabled ? 'enabled' : 'disabled'}`)
  },
})

function triggerRow(t: AgentTrigger): string[] {
  const spec = t.kind === 'interval' ? `every ${t.intervalSec}s` : `cron "${t.cronExpr}"`
  const last = t.lastFiredAt ? new Date(t.lastFiredAt).toISOString() : '(never)'
  const state = t.enabled ? 'enabled' : 'disabled'
  const msgPreview = t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message
  return [t.id, state, spec, `last: ${last}`, `"${msgPreview}"`]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List triggers for an agent' },
  args: {
    agent: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const { triggers } = await client.get<ListTriggersResponse>(
      `/api/agents/${args.agent}/triggers`,
    )
    if (triggers.length === 0) {
      console.log('(no triggers)')
      return
    }
    for (const line of columnize(triggers.map(triggerRow))) console.log(line)
  },
})

const rmCmd = defineCommand({
  meta: { name: 'rm', description: 'Delete a trigger' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/triggers/${args.id}`)
    console.log(`removed trigger ${args.id}`)
  },
})

const enableCmd = defineCommand({
  meta: { name: 'enable', description: 'Enable a trigger' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const body: UpdateTriggerRequest = { enabled: true }
    await client.patch(`/api/triggers/${args.id}`, body)
    console.log(`enabled trigger ${args.id}`)
  },
})

const disableCmd = defineCommand({
  meta: { name: 'disable', description: 'Disable a trigger' },
  args: {
    id: { type: 'positional', required: true },
  },
  async run({ args }) {
    const client = createClient()
    const body: UpdateTriggerRequest = { enabled: false }
    await client.patch(`/api/triggers/${args.id}`, body)
    console.log(`disabled trigger ${args.id}`)
  },
})

const historyCmd = defineCommand({
  meta: { name: 'history', description: 'Show recent dispatches for a trigger' },
  args: {
    id: { type: 'positional', required: true },
    limit: { type: 'string', description: 'Maximum rows (default 20)' },
  },
  async run({ args }) {
    const limit = args.limit ? Number(args.limit) : 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('--limit must be an integer from 1 to 100')
    }
    const client = createClient()
    const { dispatches } = await client.get<ListTriggerDispatchesResponse>(
      `/api/triggers/${args.id}/dispatches?limit=${limit}`,
    )
    if (dispatches.length === 0) {
      console.log('(no dispatches)')
      return
    }
    const rows = dispatches.map((dispatch) => [
      new Date(dispatch.scheduledAt).toISOString(),
      dispatch.status,
      `attempts: ${dispatch.attemptCount}`,
      dispatch.lastError ?? '',
    ])
    for (const line of columnize(rows)) console.log(line)
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
