import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Attachment, ConversationListResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const positional = { type: 'positional', required: true } as const
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2))
const common = { agent: positional }
const entry = { ...common, id: positional }
const expected = {
  type: 'string',
  required: true,
  description: 'Revision observed in queue list/show',
} as const
const list = defineCommand({
  args: { ...common, all: { type: 'boolean' }, offset: { type: 'string', default: '0' } },
  async run({ args }) {
    output(await createClient().queue(args.agent).list(args.all, Number(args.offset)))
  },
})
const show = defineCommand({
  args: entry,
  async run({ args }) {
    output(await createClient().queue(args.agent).get(args.id))
  },
})
const enqueueArgs = {
  ...common,
  message: { type: 'string' },
  files: {
    type: 'string',
    description: 'JSON array of local file paths, at most 16 and 25 MiB combined',
  },
  'request-id': { type: 'string' },
  'expected-conversation': {
    type: 'string',
    description: 'Original target ID, or none; required for retries',
  },
  'expected-selection-revision': {
    type: 'string',
    description: 'Original selection revision; required for retries',
  },
} as const
async function submit(
  args: Record<string, unknown>,
  replacement?: { id: string; expectedRevision: number },
) {
  const client = createClient()
  const agentId = String(args.agent)
  if (
    args['request-id'] &&
    (args['expected-conversation'] === undefined ||
      args['expected-selection-revision'] === undefined)
  )
    throw new Error(
      'Exact retry requires --expected-conversation and --expected-selection-revision',
    )
  const observed = await client.get<ConversationListResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/conversations?limit=1`,
  )
  const requestId = typeof args['request-id'] === 'string' ? args['request-id'] : randomUUID()
  const expectedSelection = {
    conversationId:
      args['expected-conversation'] === undefined
        ? observed.selection.conversationId
        : args['expected-conversation'] === 'none'
          ? null
          : String(args['expected-conversation']),
    revision:
      args['expected-selection-revision'] === undefined
        ? observed.selection.revision
        : Number(args['expected-selection-revision']),
  }
  const paths: unknown = args.files ? JSON.parse(String(args.files)) : []
  if (!Array.isArray(paths) || paths.length > 16 || paths.some((p) => typeof p !== 'string'))
    throw new Error('--files must be a JSON array of at most 16 paths')
  let bytes = 0
  const original =
    replacement && (args.files === undefined || args.message === undefined)
      ? await client.queue(agentId).input(replacement.id)
      : undefined
  const attachments: Attachment[] =
    args.files === undefined && original
      ? original.attachments
      : paths.map((path: string) => {
          const stat = statSync(path)
          bytes += stat.size
          if (!stat.isFile() || bytes > 25 * 1024 * 1024)
            throw new Error('Files must total at most 25 MiB')
          const mime: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.txt': 'text/plain',
            '.pdf': 'application/pdf',
          }
          return {
            name: basename(path),
            mimeType: mime[extname(path).toLowerCase()] ?? 'application/octet-stream',
            data: readFileSync(path).toString('base64'),
          }
        })
  console.error(
    `Queue request: ${requestId}; retry with --request-id ${requestId} --expected-conversation ${expectedSelection.conversationId ?? 'none'} --expected-selection-revision ${expectedSelection.revision} and identical message/files${replacement ? ' and original --expected-revision' : ''}.`,
  )
  const input = {
    requestId,
    expectedSelection,
    message: String(args.message ?? original?.message ?? ''),
    attachments,
  }
  output(
    replacement
      ? await client
          .queue(agentId)
          .edit(replacement.id, { ...input, expectedRevision: replacement.expectedRevision })
      : await client.queue(agentId).enqueue(input),
  )
}
const add = defineCommand({
  args: enqueueArgs,
  async run({ args }) {
    await submit(args)
  },
})
const edit = defineCommand({
  args: { ...enqueueArgs, id: positional, 'expected-revision': expected },
  async run({ args }) {
    await submit(args, { id: args.id, expectedRevision: Number(args['expected-revision']) })
  },
})
const remove = defineCommand({
  args: { ...entry, 'expected-revision': expected },
  async run({ args }) {
    output(
      await createClient().queue(args.agent).remove(args.id, Number(args['expected-revision'])),
    )
  },
})
const control = (paused: boolean) =>
  defineCommand({
    args: { ...common, 'expected-revision': expected },
    async run({ args }) {
      output(
        await createClient().queue(args.agent).pause(paused, Number(args['expected-revision'])),
      )
    },
  })
const stop = defineCommand({
  args: { ...common, 'expected-revision': expected },
  async run({ args }) {
    output(await createClient().queue(args.agent).stop(Number(args['expected-revision'])))
  },
})
const reconcile = defineCommand({
  args: {
    ...entry,
    'expected-revision': expected,
    acknowledge: {
      type: 'boolean',
      description: 'Acknowledge this input may already have acted; close without replay',
    },
  },
  async run({ args }) {
    if (!args.acknowledge)
      throw new Error('--acknowledge is required; this input may already have acted')
    output(
      await createClient().queue(args.agent).reconcile(args.id, Number(args['expected-revision'])),
    )
  },
})
export const queueCommand = defineCommand({
  meta: {
    name: 'queue',
    description: 'Retain follow-ups, inspect delivery and control future claims',
  },
  subCommands: {
    list,
    show,
    add,
    edit,
    remove,
    pause: control(true),
    resume: control(false),
    stop,
    reconcile,
  },
})
