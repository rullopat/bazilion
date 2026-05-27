// /api/config/telegram/* — Step 1 of the docs/telegram.md plan.
//
// Three endpoints, all admin-authed:
//
//   GET    /api/config/telegram          — read current config state (no preflight)
//   PUT    /api/config/telegram          — write {botToken, chatId} in one call
//   DELETE /api/config/telegram          — clear both
//   GET    /api/config/telegram/health   — run the four-step preflight
//
// No bot is started here — Step 2 owns the grammY singleton and the polling
// loop. Step 1 ships purely "store credentials + show whether they look
// valid" so the user can see a green/red panel without anything actually
// happening in Telegram yet.

import type { TelegramConfigInput, TelegramConfigState, TelegramHealth } from '@bazilion/api-types'
import { Hono } from 'hono'
import { openConfig, openSecrets } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { runPreflight } from '../lib/telegram/preflight.ts'

const BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN'
const CHAT_ID_KEY = 'TELEGRAM_CHAT_ID'

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
  // Bot tokens look like `<id>:<random>`. Cheap shape check — keeps obvious
  // typos out of the secrets table before the user hits the health endpoint.
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return c.json({ error: 'botToken must look like "1234567890:ABC..." (BotFather output)' }, 400)
  }
  if (!/^-?\d+$/.test(chatId)) {
    return c.json({ error: 'chatId must be a numeric id like "-1001234567890"' }, 400)
  }

  const { db, authToken } = getCtx()
  openSecrets(db, authToken).set(BOT_TOKEN_KEY, botToken)
  openConfig(db).set(CHAT_ID_KEY, chatId)

  return c.json(readState(db, authToken))
})

telegramRouter.delete('/', (c) => {
  const { db, authToken } = getCtx()
  openSecrets(db, authToken).remove(BOT_TOKEN_KEY)
  openConfig(db).remove(CHAT_ID_KEY)
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

  const health = await runPreflight({ botToken, chatId })
  return c.json(health)
})

function readState(db: ReturnType<typeof getCtx>['db'], authToken: string): TelegramConfigState {
  const botToken = openSecrets(db, authToken).get(BOT_TOKEN_KEY) ?? ''
  const chatId = openConfig(db).get(CHAT_ID_KEY) ?? ''
  return {
    configured: botToken.length > 0 && chatId.length > 0,
    chatId,
    botTokenPreview: botToken.length > 0 ? maskBotToken(botToken) : '',
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
