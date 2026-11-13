import type { AttentionKind, NotificationSettingsResponse } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'
import { jsonFlag, printJson } from '../command-helpers.ts'

function print(settings: NotificationSettingsResponse, json: boolean | undefined): void {
  if (json) {
    printJson(settings)
    return
  }
  const quiet = settings.quietHours
    ? `${settings.quietHours.start}–${settings.quietHours.end} (${settings.timezone})`
    : 'none'
  console.log(`notifications: ${settings.enabled ? 'on' : 'off'}`)
  console.log(`kinds:         ${settings.kinds.join(', ')}`)
  console.log(`quiet hours:   ${quiet}`)
  if (!settings.telegramReady)
    console.log('telegram:      not connected — notices go out once the bot runs')
}

const settings = defineCommand({
  meta: { name: 'settings', description: 'Show the Telegram attention notification settings' },
  args: { json: jsonFlag },
  async run({ args }) {
    print(await createClient().notifications.settings(), args.json)
  },
})

const configure = defineCommand({
  meta: {
    name: 'configure',
    description: 'Change the settings; options left out keep their current value',
  },
  args: {
    enable: { type: 'boolean', description: 'Send new Attention items to Telegram' },
    disable: { type: 'boolean', description: 'Stop sending them' },
    kinds: { type: 'string', description: 'Comma-separated Attention kinds' },
    timezone: { type: 'string', description: 'IANA timezone, for example Europe/Warsaw' },
    'quiet-start': { type: 'string', description: 'Start of quiet hours, HH:mm' },
    'quiet-end': { type: 'string', description: 'End of quiet hours, HH:mm' },
    'clear-quiet-hours': { type: 'boolean', description: 'Notify at any hour' },
    json: jsonFlag,
  },
  async run({ args }) {
    if (args.enable && args.disable) throw new Error('Choose --enable or --disable')
    if (Boolean(args['quiet-start']) !== Boolean(args['quiet-end']))
      throw new Error('Provide both --quiet-start and --quiet-end')
    if (args['clear-quiet-hours'] && args['quiet-start'])
      throw new Error('Choose a quiet window or --clear-quiet-hours')
    const api = createClient().notifications
    const current = await api.settings()
    const updated = await api.configure({
      enabled: args.enable ? true : args.disable ? false : current.enabled,
      kinds: args.kinds
        ? (args.kinds.split(',').map((kind) => kind.trim()) as AttentionKind[])
        : current.kinds,
      timezone: args.timezone ?? current.timezone,
      quietHours: args['clear-quiet-hours']
        ? null
        : args['quiet-start'] && args['quiet-end']
          ? { start: args['quiet-start'], end: args['quiet-end'] }
          : current.quietHours,
    })
    print(updated, args.json)
  },
})

export const notificationCommand = defineCommand({
  meta: {
    name: 'notification',
    description: 'Send new Attention items to the Telegram service topic',
  },
  subCommands: { settings, configure },
})
