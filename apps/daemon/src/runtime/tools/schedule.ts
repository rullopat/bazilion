// Schedules an Agent sets itself (BAZ-089): a reminder, a later check, a recurring job. The daemon
// keeps them with the user's own schedules and runs them in the conversation they were set in; the
// user sees every one under Schedules and can change or remove it.

import type { AgentTrigger } from '@bazilion/api-types'
import type { ScheduleEntry, ScheduleHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

const SECONDS_PER_MINUTE = 60

/** "Fri 28 Nov 2026, 09:00", on this computer's clock. */
function clock(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Now as the Agent writes a time back: "2026-11-27 14:05". */
function localNow(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function timing(trigger: AgentTrigger): string {
  if (trigger.kind === 'once') return `once, ${trigger.runAt === null ? '?' : clock(trigger.runAt)}`
  if (trigger.kind === 'cron') return `cron "${trigger.cronExpr}"`
  const seconds = trigger.intervalSec ?? 0
  return seconds % SECONDS_PER_MINUTE === 0
    ? `every ${seconds / SECONDS_PER_MINUTE} min`
    : `every ${seconds} s`
}

function where(entry: ScheduleEntry): string {
  if (entry.here) return 'runs in this conversation'
  return entry.trigger.conversationId
    ? 'runs in another of your conversations'
    : "runs in the user's current conversation with you"
}

function describe(entry: ScheduleEntry): string {
  const { trigger } = entry
  const state = !trigger.enabled
    ? 'paused'
    : entry.nextRunAt !== null
      ? `next ${clock(entry.nextRunAt)}`
      : trigger.kind === 'once' && trigger.lastFiredAt !== null
        ? 'done'
        : 'not scheduled'
  const setBy = trigger.setBy === 'agent' ? 'set by you' : 'set by the user'
  return `${trigger.id}  ${timing(trigger)}  ${setBy}  ${state}  ${where(entry)}\n  ${JSON.stringify(trigger.message)}`
}

const ID = { type: 'string', description: 'The schedule id, from schedule_list.' }

export function scheduleTools(
  host: ScheduleHost,
  now: () => Date = () => new Date(),
): ToolHandler[] {
  const date = now()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return [
    {
      def: {
        name: 'schedule_add',
        description: [
          'Set a schedule for yourself: when its time comes you get its message in a new turn, in this conversation, and the user sees your reply as they see any of your turns (on Telegram too, when you are there).',
          'Use it when the user asks for a reminder, a later check or something that repeats ("remind me Friday at nine", "check the deploy again in two hours", "every morning summarise the inbox"), or when you must come back to something yourself.',
          'Give exactly one of at, in_minutes, every_minutes and cron.',
          `Times are on this computer's clock: it is now ${localNow(date)}, ${clock(date.getTime())} (${zone}).`,
          'The user sees every schedule under Schedules and can change or remove it.',
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description:
                'What you get when it runs: write it as a note to yourself with what to do and why, since that turn starts without this one in mind.',
            },
            at: {
              type: 'string',
              description: 'Once, at this time: "YYYY-MM-DD HH:MM" on this computer\'s clock.',
            },
            in_minutes: { type: 'number', description: 'Once, this many minutes from now.' },
            every_minutes: {
              type: 'integer',
              minimum: 1,
              description: 'Again and again, this many minutes apart.',
            },
            cron: {
              type: 'string',
              description:
                'A five-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 8 * * 1-5" for weekdays at 08:00.',
            },
          },
          required: ['message'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        const entry = await host.add({
          message: String(args.message ?? ''),
          ...(args.at !== undefined ? { at: String(args.at) } : {}),
          ...(args.in_minutes !== undefined ? { inMinutes: Number(args.in_minutes) } : {}),
          ...(args.every_minutes !== undefined ? { everyMinutes: Number(args.every_minutes) } : {}),
          ...(args.cron !== undefined ? { cron: String(args.cron) } : {}),
        })
        const next = entry.nextRunAt === null ? '' : ` It runs next ${clock(entry.nextRunAt)}.`
        return `Set schedule ${entry.trigger.id}: ${timing(entry.trigger)}.${next} It runs in this conversation.`
      },
    },
    {
      def: {
        name: 'schedule_list',
        description:
          'List your schedules, the ones you set and the ones the user set: id, when, who set it, when it runs next, where it runs, and its message.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      async invoke() {
        const entries = await host.list()
        return entries.length > 0 ? entries.map(describe).join('\n') : 'You have no schedules.'
      },
    },
    {
      def: {
        name: 'schedule_remove',
        description:
          'Remove a schedule you set. The ones the user set are theirs: they change or remove them under Schedules.',
        parameters: {
          type: 'object',
          properties: { id: ID },
          required: ['id'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        const entry = await host.remove(String(args.id ?? ''))
        return `Removed schedule ${entry.trigger.id} (${timing(entry.trigger)}).`
      },
    },
  ]
}
