// `bazilion telegram` — Step 1 surface. Wires the same two endpoints the
// web UI calls (config set/clear + health). Future steps grow this tree
// with bind, adopt, setup, etc.

import type {
  Agent,
  AgentTelegramOverride,
  TelegramAllowedUser,
  TelegramBindResponse,
  TelegramConfigState,
  TelegramHealth,
} from '@bazilion/api-types'
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
    if (state.migratedChatId) {
      console.log(
        `⚠ supergroup migrated → ${state.migratedChatId}. Run \`bazilion telegram reconnect\` to apply.`,
      )
    }
  },
})

const reconnectCmd = defineCommand({
  meta: {
    name: 'reconnect',
    description: 'Apply a pending supergroup chat-id migration + re-activate the bot',
  },
  async run() {
    const client = createClient()
    const state = await client.post<TelegramConfigState>('/api/config/telegram/reconnect')
    console.log(`reconnected · chat ${state.chatId}`)
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

const botStatusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Show polling state of the live bot',
  },
  async run() {
    const client = createClient()
    const h = await client.get<TelegramHealth>('/api/config/telegram/health')
    if (!h.polling) {
      console.log('bot: not running')
      process.exitCode = 1
      return
    }
    const p = h.polling
    const startedAt = p.startedAt ? new Date(p.startedAt).toISOString() : '(never)'
    const lastPoll = p.lastSuccessfulPollAt
      ? new Date(p.lastSuccessfulPollAt).toISOString()
      : '(never)'
    console.log(`running:            ${p.running}`)
    console.log(`activated:          ${p.activated}`)
    console.log(`started at:         ${startedAt}`)
    console.log(`last update id:     ${p.lastUpdateId ?? '(none)'}`)
    console.log(`last successful:    ${lastPoll}`)
    if (p.error) console.log(`error:              ${p.error}`)
    if (!p.running) process.exitCode = 1
  },
})

const botRestartCmd = defineCommand({
  meta: {
    name: 'restart',
    description: 'Force-restart the bot (tears down + brings up from current creds)',
  },
  async run() {
    const client = createClient()
    await client.post('/api/config/telegram/restart')
    console.log('restart requested')
  },
})

const botCmd = defineCommand({
  meta: {
    name: 'bot',
    description: 'Inspect / control the live polling bot',
  },
  subCommands: {
    status: botStatusCmd,
    restart: botRestartCmd,
  },
})

const bindCmd = defineCommand({
  meta: {
    name: 'bind',
    description: 'Create a Telegram topic for an agent (manual fallback for /talk)',
  },
  args: {
    agent: { type: 'positional', required: true, description: 'Agent id or prefix' },
  },
  async run({ args }) {
    const client = createClient()
    const result = await client.post<TelegramBindResponse>(
      `/api/agents/${args.agent}/telegram/bind`,
    )
    const verb = result.created ? 'created topic' : 'already bound to'
    console.log(`${verb} #${result.topicId} for agent ${result.agent.name} (${result.agent.id})`)
    console.log(`  ${result.deepLink}`)
  },
})

const unbindCmd = defineCommand({
  meta: {
    name: 'unbind',
    description: "Clear an agent's Telegram topic binding (topic stays in Telegram as orphan)",
  },
  args: {
    agent: { type: 'positional', required: true, description: 'Agent id or prefix' },
  },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/agents/${args.agent}/telegram/binding`)
    console.log(`unbound agent ${args.agent}`)
  },
})

const listBindingsCmd = defineCommand({
  meta: {
    name: 'list',
    description: 'List agents and their Telegram topic bindings',
  },
  async run() {
    const client = createClient()
    const agents = await client.get<Agent[]>('/api/agents')
    const bound = agents.filter((a) => a.telegramTopicId !== null)
    const unbound = agents.filter((a) => a.telegramTopicId === null)
    if (bound.length === 0 && unbound.length === 0) {
      console.log('(no agents)')
      return
    }
    if (bound.length > 0) {
      console.log('bound:')
      for (const a of bound) {
        console.log(`  #${a.telegramTopicId}\t${a.name}\t(group: ${a.groupId})`)
      }
    }
    if (unbound.length > 0) {
      console.log('unbound:')
      for (const a of unbound) {
        console.log(`  —\t${a.name}\t(group: ${a.groupId})`)
      }
    }
  },
})

const allowCmd = defineCommand({
  meta: { name: 'allow', description: 'Add a Telegram user id to the allowlist' },
  args: {
    userId: { type: 'positional', required: true, description: 'Numeric Telegram user id' },
    label: { type: 'string', description: 'Optional human label' },
    owner: { type: 'boolean', description: 'Grant owner role (can manage the allowlist)' },
  },
  async run({ args }) {
    const client = createClient()
    const u = await client.post<TelegramAllowedUser>('/api/config/telegram/acl', {
      userId: Number(args.userId),
      label: args.label ?? null,
      role: args.owner ? 'owner' : 'member',
    })
    console.log(`allowed ${u.userId} (${u.role})`)
  },
})

const denyCmd = defineCommand({
  meta: { name: 'deny', description: 'Remove a Telegram user id from the allowlist' },
  args: { userId: { type: 'positional', required: true } },
  async run({ args }) {
    const client = createClient()
    await client.del(`/api/config/telegram/acl/${Number(args.userId)}`)
    console.log(`removed ${args.userId}`)
  },
})

const allowedCmd = defineCommand({
  meta: { name: 'allowed', description: 'List allowlisted Telegram users' },
  async run() {
    const client = createClient()
    const users = await client.get<TelegramAllowedUser[]>('/api/config/telegram/acl')
    if (users.length === 0) {
      console.log('(allowlist empty — open; first user to message becomes owner)')
      return
    }
    for (const u of users) {
      const who = u.label ?? (u.username ? `@${u.username}` : '—')
      console.log(`${u.userId}\t${u.role}\t${who}`)
    }
  },
})

const topicConfigCmd = defineCommand({
  meta: {
    name: 'topic-config',
    description: "View or set an agent topic's per-topic overrides (Phase 8)",
  },
  args: {
    agent: { type: 'positional', required: true, description: 'Agent id or prefix' },
    mention: { type: 'string', description: 'require_mention: true|false' },
    silent: { type: 'string', description: 'silent mirror: true|false' },
    allow: {
      type: 'string',
      description: 'Comma-separated user ids that narrow access ("" clears)',
    },
  },
  async run({ args }) {
    const client = createClient()
    const path = `/api/agents/${args.agent}/telegram/override`
    const noChange =
      args.mention === undefined && args.silent === undefined && args.allow === undefined
    if (noChange) {
      const o = await client.get<AgentTelegramOverride>(path)
      console.log(`require_mention: ${o.requireMention}`)
      console.log(`silent:          ${o.silent}`)
      console.log(
        `allow_from:      ${o.allowFrom.length ? o.allowFrom.join(', ') : '(any allowlisted)'}`,
      )
      return
    }
    const body: Record<string, unknown> = {}
    if (args.mention !== undefined) body.requireMention = args.mention === 'true'
    if (args.silent !== undefined) body.silent = args.silent === 'true'
    if (args.allow !== undefined) {
      body.allowFrom = args.allow
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n))
    }
    const o = await client.put<AgentTelegramOverride>(path, body)
    console.log(
      `updated · mention=${o.requireMention} silent=${o.silent} allow_from=[${o.allowFrom.join(', ')}]`,
    )
  },
})

export const telegramCommand = defineCommand({
  meta: {
    name: 'telegram',
    description: 'Telegram integration: credentials, health, bot lifecycle, bindings, access',
  },
  subCommands: {
    config: configCmd,
    health: healthCmd,
    bot: botCmd,
    reconnect: reconnectCmd,
    bind: bindCmd,
    unbind: unbindCmd,
    list: listBindingsCmd,
    allow: allowCmd,
    deny: denyCmd,
    allowed: allowedCmd,
    'topic-config': topicConfigCmd,
  },
})
