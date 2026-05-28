// /api/config/telegram/* — credential CRUD + preflight health + live polling state.
//
// Endpoints:
//
//   GET    /api/config/telegram           — read current config state (no preflight)
//   PUT    /api/config/telegram           — write {botToken, chatId} in one call
//                                            (restarts the bot if creds changed)
//   DELETE /api/config/telegram           — clear creds + stop the bot + wipe derived state
//   GET    /api/config/telegram/health    — run preflight + return live polling state
//   POST   /api/config/telegram/restart   — force-restart the bot (debugging)
//
// PUT/DELETE only wipe derived state (TELEGRAM_LAST_UPDATE_ID,
// TELEGRAM_SERVICE_TOPIC_ID, TELEGRAM_DIRECTORY_MESSAGE_ID) when the
// incoming credentials actually differ from what's already stored.
// Repeated idempotent saves with identical creds preserve the activated
// state so we don't orphan the existing service chat.

import type {
  AddTelegramAllowedUserRequest,
  TelegramConfigInput,
  TelegramConfigState,
  TelegramHealth,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import { openConfig, openSecrets, telegramAclRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { getTelegramBotState, restartTelegramBot, stopTelegramBot } from '../lib/telegram/bot.ts'
import { runPreflight } from '../lib/telegram/preflight.ts'

const BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN'
const CHAT_ID_KEY = 'TELEGRAM_CHAT_ID'
const MIGRATED_CHAT_ID_KEY = 'TELEGRAM_MIGRATED_CHAT_ID'
const DERIVED_STATE_KEYS = [
  'TELEGRAM_LAST_UPDATE_ID',
  'TELEGRAM_SERVICE_TOPIC_ID',
  'TELEGRAM_DIRECTORY_MESSAGE_ID',
  MIGRATED_CHAT_ID_KEY,
] as const

export const telegramRouter = new Hono()

telegramRouter.get('/', (c) => {
  const { db, authToken } = getCtx()
  return c.json(readState(db, authToken))
})

telegramRouter.put('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<TelegramConfigInput> | null
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

  // Tear down the bot synchronously so subsequent GETs reflect "not running".
  await stopTelegramBot().catch((e) =>
    console.error('telegram: stop on DELETE failed:', e instanceof Error ? e.message : e),
  )
  return c.body(null, 204)
})

// Apply a pending supergroup migration: promote TELEGRAM_MIGRATED_CHAT_ID to
// the live chat id, wipe derived state (the service topic / directory live in
// the OLD chat and must be recreated), and restart the bot so activation runs
// against the new chat. Agent topic bindings reconcile lazily on the next
// failed mirror send (thread-not-found → clear binding).
telegramRouter.post('/reconnect', (c) => {
  const { db, authToken } = getCtx()
  const config = openConfig(db)
  const migrated = (config.get(MIGRATED_CHAT_ID_KEY) ?? '').trim()
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

// ─── Per-user allowlist (Phase 7) ─────────────────────────────────────────
// HTTP callers are already bearer-authed (admin-level), so these don't apply
// the owner-role check the Telegram /allow command does — operator access is
// the auth boundary here.

telegramRouter.get('/acl', (c) => {
  const { db } = getCtx()
  return c.json(telegramAclRepo.list(db))
})

telegramRouter.post('/acl', async (c) => {
  const body = (await c.req.json().catch(() => null)) as AddTelegramAllowedUserRequest | null
  if (!body || typeof body.userId !== 'number' || !Number.isInteger(body.userId)) {
    return c.json({ error: 'userId (integer) is required' }, 400)
  }
  const { db } = getCtx()
  const user = telegramAclRepo.add(db, {
    userId: body.userId,
    username: body.username ?? null,
    label: body.label ?? null,
    role: body.role ?? 'member',
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

  const preflightResult = await runPreflight({ botToken, chatId })
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
  const migratedChatId = (config.get(MIGRATED_CHAT_ID_KEY) ?? '').trim()
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
