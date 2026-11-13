import type { Api } from 'grammy'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'

/** The running bot, for code that calls the Bot API outside the update loop. */
export interface TelegramLive {
  api: Api
  chatId: number
  db: BazilionDb
  paths: Paths
}

let current: TelegramLive | null = null

/** Null while the bot is stopped, so nothing reaches Telegram after a disconnect. */
export function telegramLive(): TelegramLive | null {
  return current
}

/** Set by the bot when it starts and cleared when it stops. */
export function setTelegramLive(live: TelegramLive | null): void {
  current = live
}
