// Telegram. /api/config/telegram: credentials, setup checks, owner pairing, allowlist and bot
// control. /api/agents/:id/telegram: an agent's forum-topic binding. /api/teams/:id/topic-format:
// a Team's topic-name template.
//
//   GET    /                    current config state (no Bot API calls)
//   PUT    /                    save {botToken, chatId}; restarts the bot when they changed
//   DELETE /                    clear credentials, stop the bot, wipe derived state
//   POST   /reconnect           switch to the supergroup a migration announced
//   POST   /restart             restart the bot
//   GET    /health              setup checks + live polling state
//   /pairing, /acl              owner pairing code and the member allowlist
//
// Saving identical credentials keeps the derived ids (service topic, directory message), so the
// existing service topic is not orphaned.

import type {
  AddTelegramAllowedUserRequest,
  SetTeamTopicFormatRequest,
  TelegramBindResponse,
  TelegramConfigInput,
  TelegramConfigState,
  TelegramHealth,
  TelegramPairingChallenge,
  TelegramPairingStatus,
} from '@bazilion/api-types'
import {
  agentRepo,
  openConfig,
  openSecrets,
  teamRepo,
  telegramAclRepo,
  telegramPairingRepo,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { getTelegramBotState, restartTelegramBot, stopTelegramBot } from '../lib/telegram/bot.ts'
import {
  BOT_TOKEN_KEY,
  CHAT_ID_KEY,
  DIRECTORY_MESSAGE_KEY,
  LAST_UPDATE_KEY,
  MIGRATED_CHAT_KEY,
  SERVICE_TOPIC_KEY,
} from '../lib/telegram/config.ts'
import { notifyDirectoryDirty } from '../lib/telegram/directory.ts'
import { telegramLive } from '../lib/telegram/live.ts'
import { validateTopicNameFormat } from '../lib/telegram/naming.ts'
import { runPreflight } from '../lib/telegram/preflight.ts'
import { ensureAgentTopic } from '../lib/telegram/topic-autocreate.ts'
import { syncTeamTopicNames } from '../lib/telegram/topic-rename.ts'
import { jsonBody, newRouter, routeAgent, routeTeam } from './http.ts'

const DERIVED_STATE_KEYS = [
  LAST_UPDATE_KEY,
  SERVICE_TOPIC_KEY,
  DIRECTORY_MESSAGE_KEY,
  MIGRATED_CHAT_KEY,
] as const

export const telegramRouter = newRouter()

telegramRouter.get('/', (c) => {
  const { db, authToken } = getCtx()
  return c.json(readState(db, authToken))
})

telegramRouter.put('/', async (c) => {
  const body = await jsonBody<TelegramConfigInput>(c)
  if (!body || typeof body.botToken !== 'string' || typeof body.chatId !== 'string') {
    return c.json({ error: 'body must be {"botToken": "<string>", "chatId": "<string>"}' }, 400)
  }

  const botToken = body.botToken.trim()
  const chatId = body.chatId.trim()
  if (!botToken || !chatId) {
    return c.json({ error: 'botToken and chatId must be non-empty' }, 400)
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return c.json({ error: 'botToken must look like "1234567890:ABC..." (BotFather output)' }, 400)
  }
  if (!/^-?\d+$/.test(chatId)) {
    return c.json({ error: 'chatId must be a numeric id like "-1001234567890"' }, 400)
  }

  const { db, authToken } = getCtx()
  const secrets = openSecrets(db, authToken)
  const config = openConfig(db)

  const prevToken = secrets.get(BOT_TOKEN_KEY) ?? ''
  const prevChatId = config.get(CHAT_ID_KEY) ?? ''
  const credsChanged = prevToken !== botToken || prevChatId !== chatId

  if (credsChanged) {
    // Fresh credentials → wipe derived state so the next activation starts
    // from scratch. Stale service-topic / directory-message ids from the
    // previous bot would never resolve in the new chat anyway.
    for (const key of DERIVED_STATE_KEYS) config.remove(key)
    telegramPairingRepo.reset(db)
  }

  secrets.set(BOT_TOKEN_KEY, botToken)
  config.set(CHAT_ID_KEY, chatId)

  // Restart the bot to pick up the new credentials. Fire-and-forget: the
  // restart can take ~25s (long-poll teardown) and we don't want the HTTP
  // response to block on it. Errors surface on the next /health call via
  // polling.error.
  if (credsChanged) {
    void restartTelegramBot(db, authToken).catch((e) =>
      console.error('telegram: PUT-triggered restart failed:', e instanceof Error ? e.message : e),
    )
  }

  return c.json(readState(db, authToken))
})

telegramRouter.delete('/', async (c) => {
  const { db, authToken } = getCtx()
  const secrets = openSecrets(db, authToken)
  const config = openConfig(db)

  secrets.remove(BOT_TOKEN_KEY)
  config.remove(CHAT_ID_KEY)
  for (const key of DERIVED_STATE_KEYS) config.remove(key)
  telegramPairingRepo.reset(db)

  // Tear down the bot synchronously so subsequent GETs reflect "not running".
  await stopTelegramBot().catch((e) =>
    console.error('telegram: stop on DELETE failed:', e instanceof Error ? e.message : e),
  )
  return c.body(null, 204)
})

// Apply a pending supergroup migration: promote the announced chat id to
// the live chat id, wipe derived state (the service topic / directory live in
// the OLD chat and must be recreated), and restart the bot so activation runs
// against the new chat. Agent topic bindings reconcile lazily on the next
// failed mirror send (thread-not-found → clear binding).
telegramRouter.post('/reconnect', (c) => {
  const { db, authToken } = getCtx()
  const config = openConfig(db)
  const migrated = (config.get(MIGRATED_CHAT_KEY) ?? '').trim()
  if (!migrated) return c.json({ error: 'no migrated chat id pending' }, 400)
  config.set(CHAT_ID_KEY, migrated)
  for (const key of DERIVED_STATE_KEYS) config.remove(key)
  void restartTelegramBot(db, authToken).catch((e) =>
    console.error('telegram: reconnect restart failed:', e instanceof Error ? e.message : e),
  )
  return c.json(readState(db, authToken))
})

telegramRouter.post('/restart', async (c) => {
  const { db, authToken } = getCtx()
  // Fire-and-forget; same reasoning as PUT.
  void restartTelegramBot(db, authToken).catch((e) =>
    console.error('telegram: explicit restart failed:', e instanceof Error ? e.message : e),
  )
  return c.json({ restarted: true })
})

telegramRouter.get('/pairing', (c) => {
  const { db } = getCtx()
  return c.json(telegramPairingRepo.status(db) satisfies TelegramPairingStatus)
})

telegramRouter.post('/pairing/challenge', (c) => {
  const { db } = getCtx()
  const challenge = telegramPairingRepo.create(db)
  return c.json(
    { ...telegramPairingRepo.status(db), ...challenge } satisfies TelegramPairingChallenge,
    201,
  )
})

telegramRouter.delete('/pairing/challenge', (c) => {
  const { db } = getCtx()
  telegramPairingRepo.cancel(db)
  return c.body(null, 204)
})

telegramRouter.post('/pairing/reset', async (c) => {
  const body = await jsonBody<{ confirm: true }>(c)
  if (body?.confirm !== true) return c.json({ error: 'body must include {"confirm": true}' }, 400)
  const { db } = getCtx()
  telegramPairingRepo.reset(db)
  return c.json(telegramPairingRepo.status(db) satisfies TelegramPairingStatus)
})

// ─── Member allowlist ─────────────────────────────────────────────────────
// HTTP callers are already authenticated operators, so these skip the owner-role
// check the Telegram /allow command applies.

telegramRouter.get('/acl', (c) => {
  const { db } = getCtx()
  return c.json(telegramAclRepo.list(db))
})

telegramRouter.post('/acl', async (c) => {
  const body = await jsonBody<AddTelegramAllowedUserRequest>(c)
  if (!body || typeof body.userId !== 'number' || !Number.isInteger(body.userId)) {
    return c.json({ error: 'userId (integer) is required' }, 400)
  }
  const { db } = getCtx()
  if (!telegramPairingRepo.status(db).paired) {
    return c.json({ error: 'pair the Telegram owner before adding members' }, 409)
  }
  if (body.role === 'owner') {
    return c.json({ error: 'owners are created only through the pairing flow' }, 409)
  }
  const user = telegramAclRepo.add(db, {
    userId: body.userId,
    username: body.username ?? null,
    label: body.label ?? null,
    role: 'member',
  })
  return c.json(user, 201)
})

telegramRouter.delete('/acl/:userId', (c) => {
  const userId = Number(c.req.param('userId'))
  if (!Number.isInteger(userId)) return c.json({ error: 'userId must be an integer' }, 400)
  const { db } = getCtx()
  const removed = telegramAclRepo.remove(db, userId)
  if (!removed) {
    return c.json({ error: 'cannot remove: unknown user or last remaining owner' }, 409)
  }
  return c.body(null, 204)
})

telegramRouter.get('/health', async (c) => {
  const { db, authToken } = getCtx()
  const botToken = openSecrets(db, authToken).get(BOT_TOKEN_KEY) ?? ''
  const chatId = openConfig(db).get(CHAT_ID_KEY) ?? ''

  if (!botToken || !chatId) {
    const unconfigured: TelegramHealth = {
      configured: false,
      preflight: null,
      error: null,
      polling: null,
    }
    return c.json(unconfigured)
  }

  const pairing = telegramPairingRepo.status(db)
  const preflightResult = await runPreflight({
    botToken,
    chatId,
    ownerUserId: pairing.ownerUserId,
  })
  // Layer the live polling state on top of the preflight result. Preflight
  // sets polling: null; we replace with the live state if a bot is running.
  const merged: TelegramHealth = {
    ...preflightResult,
    polling: getTelegramBotState(),
  }
  return c.json(merged)
})

function readState(db: ReturnType<typeof getCtx>['db'], authToken: string): TelegramConfigState {
  const config = openConfig(db)
  const botToken = openSecrets(db, authToken).get(BOT_TOKEN_KEY) ?? ''
  const chatId = config.get(CHAT_ID_KEY) ?? ''
  const migratedChatId = (config.get(MIGRATED_CHAT_KEY) ?? '').trim()
  return {
    configured: botToken.length > 0 && chatId.length > 0,
    chatId,
    botTokenPreview: botToken.length > 0 ? maskBotToken(botToken) : '',
    migratedChatId: migratedChatId || null,
  }
}

/**
 * Show enough of the token to identify it (the numeric bot id is the prefix
 * before `:`, and a few chars of the random tail), without spilling the
 * secret in clear.
 */
function maskBotToken(t: string): string {
  const colonIdx = t.indexOf(':')
  if (colonIdx <= 0) return '***'
  const head = t.slice(0, colonIdx)
  const tail = t.slice(colonIdx + 1)
  return `${head}:${tail.slice(0, 4)}…`
}

// ─── Agent topic binding ──────────────────────────────────────────────────
// The HTTP form of the topic-context `/talk` and `/unbind` commands: bind creates (or finds)
// the agent's forum topic like `/talk` does; unbind just clears the binding.

export const agentTelegramRouter = newRouter()

agentTelegramRouter.post('/:id/telegram/bind', async (c) => {
  const { db, paths } = getCtx()
  const { id } = routeAgent(c)
  const live = telegramLive()
  if (!live) {
    return c.json(
      {
        error:
          'Telegram bot is not running — configure credentials at /config/integrations/telegram',
      },
      503,
    )
  }
  const result = await ensureAgentTopic({
    db,
    paths,
    api: live.api as unknown as Parameters<typeof ensureAgentTopic>[0]['api'],
    chatId: live.chatId,
    agentId: id,
  })
  if (result.kind === 'agent-not-found') return c.json({ error: `agent not found: ${id}` }, 404)
  if (result.kind === 'team-not-found') return c.json({ error: 'team not found for agent' }, 500)
  const agent = agentRepo.get(db, id)
  if (!agent) return c.json({ error: `agent not found: ${id}` }, 404)
  return c.json({
    agent,
    topicId: result.topicId,
    deepLink: result.deepLink,
    created: result.created,
  } satisfies TelegramBindResponse)
})

agentTelegramRouter.delete('/:id/telegram/binding', (c) => {
  agentRepo.setTelegramTopicId(getCtx().db, routeAgent(c).id, null)
  notifyDirectoryDirty()
  return c.body(null, 204)
})

// ─── Team topic names ─────────────────────────────────────────────────────

export const teamTelegramRouter = newRouter()

teamTelegramRouter.put('/:id/topic-format', async (c) => {
  const body = await jsonBody<SetTeamTopicFormatRequest>(c)
  if (!body || (body.format !== null && typeof body.format !== 'string')) {
    return c.json({ error: 'format (string or null) is required' }, 400)
  }
  const { db, paths } = getCtx()
  const { id } = routeTeam(c)
  // An empty or whitespace-only string clears the template.
  const format = body.format?.trim() ? body.format : null
  if (format !== null) {
    const err = validateTopicNameFormat(format)
    if (err) return c.json({ error: err }, 400)
  }
  teamRepo.setTelegramTopicNameFormat(db, id, format)
  // Re-render existing topics in the background; no-op when the bot isn't running.
  void syncTeamTopicNames(db, paths, id).catch((e) =>
    console.warn('telegram: topic-name sync after format change failed:', e),
  )
  return c.json(teamRepo.get(db, id, paths))
})
