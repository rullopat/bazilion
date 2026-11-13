import type { UserQueueItem } from '@bazilion/api-types'
import { telegramLive } from './live.ts'
import type { TelegramOrigin } from './origin.ts'
import { enqueueOutbound } from './outbound-queue.ts'

const OUTCOME = {
  failed: 'This message failed.',
  cancelled: 'This message was cancelled.',
  removed: 'This message was removed from the queue.',
} as const

/** Reply to a queued Telegram message that did not complete. Best effort, never a retry. */
export async function notifyTelegramQueueOutcome(
  item: UserQueueItem,
  origin: unknown,
  outcome: keyof typeof OUTCOME,
): Promise<void> {
  const live = telegramLive()
  const from = origin as TelegramOrigin | null
  // After a reconnect to a migrated chat, the old chat is no longer the bot's to post in.
  if (!live || item.source !== 'telegram' || !from || from.chatId !== live.chatId) return
  try {
    await enqueueOutbound(live.chatId, () =>
      live.api.sendMessage(from.chatId, OUTCOME[outcome], {
        message_thread_id: from.threadId,
        reply_parameters: { message_id: from.messageId, allow_sending_without_reply: true },
      }),
    )
  } catch {
    // The queue item keeps its outcome; a lost notice changes nothing.
  }
}
