import type { AttentionKind } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const output = (value: unknown) => console.log(JSON.stringify(value, null, 2))
const positional = { type: 'positional', required: true } as const
export const notificationCommand = defineCommand({
  meta: {
    name: 'notification',
    description: 'Configure opt-in Telegram Attention notices and inspect delivery receipts',
  },
  subCommands: {
    settings: defineCommand({
      async run() {
        output(await createClient().notifications.settings())
      },
    }),
    preview: defineCommand({
      args: {
        kinds: {
          type: 'string',
          description: 'Comma-separated Attention kinds; defaults to current selection',
        },
      },
      async run({ args }) {
        const api = createClient().notifications
        const kinds = args.kinds
          ? (args.kinds.split(',') as AttentionKind[])
          : (await api.settings()).settings.kinds
        output(await api.preview(kinds))
      },
    }),
    configure: defineCommand({
      args: {
        enable: { type: 'boolean' },
        disable: { type: 'boolean' },
        'destination-id': {
          type: 'string',
          description:
            'Explicit verified service destination ID from settings; required with --enable',
        },
        kinds: { type: 'string', description: 'Comma-separated Attention kinds' },
        timezone: { type: 'string', description: 'IANA timezone, for example Europe/Warsaw' },
        'quiet-start': { type: 'string', description: 'Quiet start, HH:mm' },
        'quiet-end': { type: 'string', description: 'Quiet end, HH:mm' },
        'clear-quiet-hours': { type: 'boolean' },
        'include-open-preview': {
          type: 'string',
          description:
            'Explicitly include the captured preview; restored history may duplicate Telegram messages',
        },
        'expected-revision': { type: 'string' },
      },
      async run({ args }) {
        if (args.enable && args.disable) throw new Error('Choose --enable or --disable')
        if (args.enable && !args['destination-id'])
          throw new Error('--enable requires --destination-id from notification settings')
        if (Boolean(args['quiet-start']) !== Boolean(args['quiet-end']))
          throw new Error('Provide both --quiet-start and --quiet-end')
        if (args['clear-quiet-hours'] && args['quiet-start'])
          throw new Error('Choose a quiet window or --clear-quiet-hours')
        const api = createClient().notifications
        const { settings } = await api.settings()
        output(
          await api.configure({
            expectedRevision:
              args['expected-revision'] === undefined
                ? settings.revision
                : Number(args['expected-revision']),
            enabled: args.enable ? true : args.disable ? false : settings.enabled,
            destinationId: args['destination-id'] ?? settings.destination?.id,
            kinds: args.kinds ? (args.kinds.split(',') as AttentionKind[]) : settings.kinds,
            timezone: args.timezone ?? settings.timezone,
            quietHours: args['clear-quiet-hours']
              ? null
              : args['quiet-start'] && args['quiet-end']
                ? { start: args['quiet-start'], end: args['quiet-end'] }
                : settings.quietHours,
            includeOpenPreview: args['include-open-preview'],
          }),
        )
      },
    }),
    list: defineCommand({
      args: { cursor: { type: 'string' }, limit: { type: 'string' } },
      async run({ args }) {
        output(
          await createClient().notifications.list({
            cursor: args.cursor,
            limit: args.limit === undefined ? undefined : Number(args.limit),
          }),
        )
      },
    }),
    show: defineCommand({
      args: { id: positional },
      async run({ args }) {
        output(await createClient().notifications.get(args.id))
      },
    }),
    retry: defineCommand({
      args: {
        id: positional,
        'acknowledge-possible-duplicate': {
          type: 'boolean',
          description: 'Telegram may already have received this notice',
        },
      },
      async run({ args }) {
        if (!args['acknowledge-possible-duplicate'])
          throw new Error('Explicit retry requires --acknowledge-possible-duplicate')
        const api = createClient().notifications
        const receipt = await api.get(args.id)
        output(
          await api.retry(args.id, {
            expectedUpdatedAt: receipt.updatedAt,
            acknowledgePossibleDuplicate: true,
          }),
        )
      },
    }),
  },
})
