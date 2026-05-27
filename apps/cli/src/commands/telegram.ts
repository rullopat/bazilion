// `bazilion telegram` — Step 1 surface. Wires the same two endpoints the
// web UI calls (config set/clear + health). Future steps grow this tree
// with bind, adopt, setup, etc.

import type { TelegramConfigState, TelegramHealth } from '@bazilion/api-types'
import { defineCommand } from 'citty'
import { createClient } from '../client.ts'

const setCmd = defineCommand({
  meta: {
    name: 'set',
    description: 'Save bot token + supergroup chat ID (paired write)',
  },
  args: {
    token: { type: 'string', required: true, description: 'Bot token from @BotFather' },
    chat: { type: 'string', required: true, description: 'Numeric supergroup chat ID' },
  },
  async run({ args }) {
    const client = createClient()
    const state = await client.put<TelegramConfigState>('/api/config/telegram', {
      botToken: args.token,
      chatId: args.chat,
    })
    console.log(`saved · token ${state.botTokenPreview} · chat ${state.chatId}`)
  },
})

const clearCmd = defineCommand({
  meta: {
    name: 'clear',
    description: 'Remove stored bot token + chat ID',
  },
  async run() {
    const client = createClient()
    await client.del('/api/config/telegram')
    console.log('cleared')
  },
})

const showCmd = defineCommand({
  meta: {
    name: 'show',
    description: 'Show what credentials are stored (token is masked)',
  },
  async run() {
    const client = createClient()
    const state = await client.get<TelegramConfigState>('/api/config/telegram')
    if (!state.configured) {
      console.log('(no credentials saved — run `bazilion telegram config set --token … --chat …`)')
      return
    }
    console.log(`token: ${state.botTokenPreview}`)
    console.log(`chat:  ${state.chatId}`)
  },
})

const configCmd = defineCommand({
  meta: {
    name: 'config',
    description: 'Manage Telegram credentials (bot token + chat ID)',
  },
  subCommands: {
    set: setCmd,
    clear: clearCmd,
    show: showCmd,
  },
})

const healthCmd = defineCommand({
  meta: {
    name: 'health',
    description: 'Run the four-step preflight against the Telegram Bot API',
  },
  async run() {
    const client = createClient()
    const h = await client.get<TelegramHealth>('/api/config/telegram/health')
    if (!h.configured) {
      console.log('not configured — run `bazilion telegram config set` first')
      process.exitCode = 1
      return
    }
    if (h.error) {
      console.error(`error at ${h.error.step}: ${h.error.message}`)
      process.exitCode = 1
      return
    }
    if (!h.preflight) {
      console.error('preflight returned no data')
      process.exitCode = 1
      return
    }
    const p = h.preflight
    const line = (ok: boolean, label: string, detail: string): string =>
      `${ok ? '✓' : '✕'} ${label.padEnd(30)} ${detail}`
    console.log(line(p.botUsername.length > 0, 'bot identity', `@${p.botUsername}`))
    console.log(line(p.chatTitle.length > 0, 'supergroup reachable', p.chatTitle))
    console.log(line(p.isForum, 'forum topics enabled', String(p.isForum)))
    console.log(line(p.hasManageTopics, 'can_manage_topics', String(p.hasManageTopics)))
    console.log(line(p.privacyModeOff, 'Privacy Mode is OFF', String(p.privacyModeOff)))
    const allOk =
      p.botUsername.length > 0 &&
      p.chatTitle.length > 0 &&
      p.isForum &&
      p.hasManageTopics &&
      p.privacyModeOff
    if (!allOk) process.exitCode = 1
  },
})

export const telegramCommand = defineCommand({
  meta: {
    name: 'telegram',
    description: 'Telegram integration: credentials + health (live bot ships in step 2)',
  },
  subCommands: {
    config: configCmd,
    health: healthCmd,
  },
})
