import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig, openSecrets } from '../../core/index.ts'

export const BOT_TOKEN_KEY = 'TELEGRAM_BOT_TOKEN'
export const CHAT_ID_KEY = 'TELEGRAM_CHAT_ID'
/** Ids the bot derives at runtime; cleared when the credentials change. */
export const LAST_UPDATE_KEY = 'TELEGRAM_LAST_UPDATE_ID'
export const SERVICE_TOPIC_KEY = 'TELEGRAM_SERVICE_TOPIC_ID'
export const DIRECTORY_MESSAGE_KEY = 'TELEGRAM_DIRECTORY_MESSAGE_ID'
export const MIGRATED_CHAT_KEY = 'TELEGRAM_MIGRATED_CHAT_ID'

export function readConfigNumber(db: BazilionDb, key: string): number | null {
  const raw = openConfig(db).get(key) ?? ''
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function readServiceTopicId(db: BazilionDb): number | null {
  return readConfigNumber(db, SERVICE_TOPIC_KEY)
}

export function readCreds(
  db: BazilionDb,
  authToken: string,
): { botToken: string; chatId: number } | null {
  const botToken = openSecrets(db, authToken).get(BOT_TOKEN_KEY) ?? ''
  const chatId = readConfigNumber(db, CHAT_ID_KEY)
  return botToken && chatId !== null ? { botToken, chatId } : null
}

/** Bot API errors can embed the request URL, which carries the bot token. */
export function redactToken(text: string, botToken?: string): string {
  return (botToken ? text.replaceAll(botToken, '[redacted]') : text).replace(
    /bot\d+:[A-Za-z0-9_-]+/g,
    'bot[redacted]',
  )
}
