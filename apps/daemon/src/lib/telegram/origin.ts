import type { BazilionDb } from '../../core/db/client.ts'
import { telegramAclRepo, telegramPairingRepo } from '../../core/index.ts'

/** Where a queued Telegram message came from; notices about it go back to the same topic. */
export interface TelegramOrigin {
  chatId: number
  threadId: number
  messageId: number
  userId: number
}

/** One Telegram message is one queue attempt, so a redelivered update is not queued twice. */
export function telegramAttemptId(origin: Pick<TelegramOrigin, 'chatId' | 'messageId'>): string {
  return `${origin.chatId}:${origin.messageId}`
}

/**
 * The one sender rule: a person on the allowlist of a paired bot. Checked when a message arrives
 * and again before its queued turn runs, so removing someone also drops what they queued.
 */
export function isTelegramSenderAllowed(db: BazilionDb, userId: number): boolean {
  return telegramPairingRepo.status(db).paired && telegramAclRepo.isAllowed(db, userId)
}
