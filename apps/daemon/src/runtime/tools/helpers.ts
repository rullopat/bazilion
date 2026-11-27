// Helpers (BAZ-092): helper_start runs the same Agent on one self-contained task in a
// conversation of its own, beside this turn; helper_wait waits for their answers, showing what
// each is doing as live output; helper_stop ends one. A helper has the Agent's tools except these
// and ask_user, so it cannot start helpers of its own.

import type { Helper } from '@bazilion/api-types'
import type { HelperHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

/** How often helper_wait refreshes its live output: it shapes what the chat shows, nothing else. */
const PROGRESS_MS = 2_000

function state(helper: Helper): string {
  if (helper.status === 'running') return `running, ${helper.activity}`
  if (helper.status === 'done') return 'done'
  if (helper.status === 'failed') return `failed: ${helper.error ?? 'unknown'}`
  return helper.stoppedBy === 'agent'
    ? 'stopped by you'
    : helper.stoppedBy === 'owner'
      ? 'stopped by the user'
      : 'stopped with the turn that started it'
}

function line(helper: Helper): string {
  const task = helper.task.split('\n')[0] ?? ''
  return `${helper.id} (${task.length > 80 ? `${task.slice(0, 80)}…` : task}): ${state(helper)}`
}

const ids = (args: Record<string, unknown>): string[] => [
  ...(typeof args.id === 'string' && args.id ? [args.id] : []),
  ...(Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : []),
]

export function helperTools(host: HelperHost): ToolHandler[] {
  return [
    {
      def: {
        name: 'helper_start',
        description:
          'Start a helper: another run of yourself for one self-contained task (read these sources, try this approach), in a conversation of its own, beside this turn. It answers at once with the helper id. Several can run at once, so start one per independent task, then wait for them with helper_wait. A helper starts without this conversation in mind: give it the whole task. Its pages and output stay out of your context; you get its final answer.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The whole task, with what it needs to know and what to answer with.',
            },
            model: {
              type: 'string',
              description: 'A provider:model to run it on instead of your own (optional).',
            },
          },
          required: ['task'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        const helper = await host.start({
          task: args.task,
          ...(args.model !== undefined ? { model: args.model } : {}),
        })
        return `Started ${helper.id}. Wait for its answer with helper_wait; an answer that comes after this turn starts a turn of your own.`
      },
    },
    {
      def: {
        name: 'helper_wait',
        description:
          'Wait for your helpers to finish and get their answers. With ids it waits for all of them; with wait_seconds it returns after that long with what has finished so far. What each is doing shows while you wait.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'One helper id.' },
            ids: { type: 'array', items: { type: 'string' }, description: 'Several helper ids.' },
            wait_seconds: {
              type: 'number',
              minimum: 0,
              description: 'Return after this long at most (optional): without it, wait for all.',
            },
          },
          additionalProperties: false,
        },
      },
      async invoke(args, call) {
        const wanted = ids(args)
        if (wanted.length === 0) throw new Error('helper_wait: give id or ids')
        const limit =
          typeof args.wait_seconds === 'number' && args.wait_seconds >= 0
            ? Date.now() + args.wait_seconds * 1000
            : null
        let helpers: Helper[] = []
        for (;;) {
          const left = limit === null ? PROGRESS_MS : Math.max(0, limit - Date.now())
          helpers = await host.wait({ ids: wanted, waitMs: Math.min(PROGRESS_MS, left) })
          if (call?.signal?.aborted) throw new Error('helper_wait: the turn was stopped')
          call?.progress?.(helpers.map(line).join('\n'))
          const running = helpers.some((helper) => helper.status === 'running')
          if (!running || (limit !== null && Date.now() >= limit)) break
        }
        return helpers
          .map((helper) =>
            helper.status === 'done'
              ? `${line(helper)}\nIts answer:\n${helper.answer || '(it gave none)'}`
              : line(helper),
          )
          .join('\n\n')
      },
    },
    {
      def: {
        name: 'helper_stop',
        description: 'Stop one of your helpers. One that has finished stays as it is.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'The helper id.' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
      async invoke(args) {
        return line(await host.stop({ id: String(args.id ?? '') }))
      },
    },
  ]
}
