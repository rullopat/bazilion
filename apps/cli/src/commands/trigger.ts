import type {
  AgentTrigger,
  CreateTriggerRequest,
  CreateTriggerResponse,
  ListTriggerDispatchesResponse,
  ListTriggersResponse,
  TriggerTiming,
  UpdateTriggerRequest,
  UpdateTriggerResponse,
} from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { agentArg, apiPath, positional, printRows } from '../command-helpers.ts'

const triggerArg = positional('Trigger id')

function spec(t: AgentTrigger): string {
  if (t.kind === 'once') return `once ${t.runAt === null ? '?' : localTime(t.runAt)}`
  return t.kind === 'interval' ? `every ${t.intervalSec}s` : `cron "${t.cronExpr}"`
}

/** "2026-11-28 09:00" on this computer's clock, as `--at` takes it. */
function localTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `--at "2026-11-28 09:00"`: a time on this computer's clock, where the daemon runs. */
function parseAt(text: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(text.trim())
  const ms = match
    ? new Date(`${match[1]}T${(match[2] as string).padStart(5, '0')}`).getTime()
    : NaN
  if (!Number.isFinite(ms)) throw new Error(`--at takes "YYYY-MM-DD HH:MM", not "${text}"`)
  return ms
}

const TIMING_ARGS = {
  every: {
    type: 'string',
    description: 'Interval in seconds (e.g. --every 300 = every 5 minutes)',
  },
  cron: {
    type: 'string',
    description: 'Cron expression (5 fields: minute hour dom month dow)',
  },
  at: {
    type: 'string',
    description: 'Once, at "YYYY-MM-DD HH:MM" on this computer\'s clock',
  },
} as const

/** The timing the flags give: none, or exactly one of --every, --cron and --at. */
function timingOf(args: { every?: string; cron?: string; at?: string }): TriggerTiming | null {
  const given = [args.every, args.cron, args.at].filter((value) => value !== undefined)
  if (given.length === 0) return null
  if (given.length > 1) throw new Error('give only one of --every, --cron and --at')
  if (args.every !== undefined) return { kind: 'interval', intervalSec: Number(args.every) }
  if (args.cron !== undefined) return { kind: 'cron', cronExpr: args.cron }
  return { kind: 'once', runAt: parseAt(args.at as string) }
}

const addCmd = defineCommand({
  meta: { name: 'add', description: 'Add an interval, cron or one-time trigger to an agent' },
  args: {
    agent: agentArg,
    ...TIMING_ARGS,
    message: {
      type: 'string',
      required: true,
      description: 'Message to inject when the trigger fires',
    },
    disabled: { type: 'boolean', description: 'Create in disabled state' },
  },
  async run({ args }) {
    const timing = timingOf(args)
    if (!timing) throw new Error('give one of --every <seconds>, --cron "<expr>" or --at "<time>"')
    const body: CreateTriggerRequest = { ...timing, message: args.message, enabled: !args.disabled }
    const { trigger } = await createClient().post<CreateTriggerResponse>(
      apiPath('agents', args.agent, 'triggers'),
      body,
    )
    console.log(`${trigger.id}\t${spec(trigger)}\t${trigger.enabled ? 'enabled' : 'disabled'}`)
  },
})

const editCmd = defineCommand({
  meta: {
    name: 'edit',
    description: "Change a trigger's timing or message, whether you or its Agent set it",
  },
  args: {
    id: positional('Trigger id'),
    ...TIMING_ARGS,
    message: { type: 'string', description: 'The new message' },
  },
  async run({ args }) {
    const timing = timingOf(args)
    if (!timing && args.message === undefined) {
      throw new Error('give a new --message, or one of --every, --cron and --at')
    }
    const body: UpdateTriggerRequest = {
      ...(timing ?? {}),
      ...(args.message !== undefined ? { message: args.message } : {}),
    }
    const { trigger } = await createClient().patch<UpdateTriggerResponse>(
      apiPath('triggers', args.id),
      body,
    )
    console.log(`${trigger.id}\t${spec(trigger)}\t${trigger.enabled ? 'enabled' : 'disabled'}`)
  },
})

function triggerRow(t: AgentTrigger, next: number | null | undefined): string[] {
  const last = t.lastFiredAt ? new Date(t.lastFiredAt).toISOString() : '(never)'
  const state = t.enabled ? 'enabled' : 'disabled'
  const msgPreview = t.message.length > 60 ? `${t.message.slice(0, 60)}…` : t.message
  const upcoming =
    typeof next === 'number'
      ? new Date(next).toISOString()
      : t.kind === 'once' && t.lastFiredAt !== null
        ? 'done'
        : '-'
  const setBy = t.setBy === 'agent' ? 'set by the agent' : 'set by you'
  return [t.id, state, spec(t), setBy, `next: ${upcoming}`, `last: ${last}`, `"${msgPreview}"`]
}

const listCmd = defineCommand({
  meta: { name: 'list', description: 'List triggers for an agent' },
  args: { agent: agentArg },
  async run({ args }) {
    const { triggers, nextRuns, schedulerOff } = await createClient().get<ListTriggersResponse>(
      apiPath('agents', args.agent, 'triggers'),
    )
    printRows(
      triggers.map((trigger) => triggerRow(trigger, nextRuns[trigger.id])),
      '(no triggers)',
    )
    if (schedulerOff && triggers.length > 0)
      console.log('The daemon runs no schedules: it was started with BAZILION_SCHEDULER=off.')
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
    edit: editCmd,
    list: listCmd,
    rm: rmCmd,
    enable: enableCmd,
    disable: disableCmd,
    history: historyCmd,
  },
})
