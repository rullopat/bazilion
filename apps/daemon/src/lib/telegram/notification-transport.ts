import { createHash } from 'node:crypto'
import type { BazilionDb } from '../../core/db/client.ts'
import type { NotificationBinding } from '../../core/repos/notifications.ts'
import { mergeSecretsIntoEnv } from '../../core/secrets.ts'

export interface NotificationTransport {
  capture(): NotificationBinding | null
  verify(binding: NotificationBinding): Promise<boolean>
  send(
    binding: NotificationBinding,
    text: string,
    signal: AbortSignal,
  ): Promise<{ message_id: number }>
}
interface LiveTransport {
  db: BazilionDb
  authToken: string
  botToken: string
  verify(chatId: number, ownerId: number, signal: AbortSignal): Promise<boolean>
  send(
    chatId: number,
    topicId: number,
    text: string,
    signal: AbortSignal,
  ): Promise<{ message_id: number }>
}
let resolver: (() => LiveTransport | null) | null = null
export function notificationDestinationAllowed(
  chat: { type: string; is_forum?: boolean; username?: string; active_usernames?: string[] },
  owner: { status: string; is_member?: boolean },
  bot: { status: string; can_manage_topics?: boolean },
): boolean {
  return (
    chat.type === 'supergroup' &&
    chat.is_forum === true &&
    !chat.username &&
    !chat.active_usernames?.length &&
    owner.status !== 'left' &&
    owner.status !== 'kicked' &&
    (owner.status !== 'restricted' || owner.is_member === true) &&
    (bot.status === 'creator' || (bot.status === 'administrator' && bot.can_manage_topics === true))
  )
}
export function installNotificationTransport(value: (() => LiveTransport | null) | null): void {
  resolver = value
}
function capture(
  db: BazilionDb,
  authToken: string,
): { binding: NotificationBinding; ownerId: number; live: LiveTransport } | null {
  const live = resolver?.()
  if (!live || live.db !== db || live.authToken !== authToken) return null
  const env = mergeSecretsIntoEnv(db, authToken)
  const owner = db.raw
    .query<{ user_id: number; grant_id: string }, []>(
      "SELECT user_id, grant_id FROM telegram_allowed_users WHERE role='owner' LIMIT 1",
    )
    .get()
  const topic = db.raw
    .query<{ value: string }, []>("SELECT value FROM config WHERE key='TELEGRAM_SERVICE_TOPIC_ID'")
    .get()
  const envelope =
    db.raw
      .query<{ envelope: string }, []>(
        "SELECT envelope FROM secrets WHERE key='TELEGRAM_BOT_TOKEN'",
      )
      .get()?.envelope ?? null
  const chatId = Number(env.TELEGRAM_CHAT_ID)
  const topicId = Number(topic?.value)
  if (
    !owner ||
    !Number.isSafeInteger(chatId) ||
    chatId >= 0 ||
    !Number.isSafeInteger(topicId) ||
    topicId <= 0 ||
    !env.TELEGRAM_BOT_TOKEN ||
    env.TELEGRAM_BOT_TOKEN !== live.botToken
  )
    return null
  const botDigest = createHash('sha256')
    .update(JSON.stringify([live.botToken, envelope]))
    .digest('hex')
  const id = createHash('sha256')
    .update(JSON.stringify([chatId, topicId, owner.grant_id, botDigest]))
    .digest('hex')
  return {
    binding: { id, chatId, topicId, ownerGrantId: owner.grant_id, botDigest },
    ownerId: owner.user_id,
    live,
  }
}
export function telegramNotificationTransport(
  db: BazilionDb,
  authToken: string,
): NotificationTransport {
  const requireBinding = (binding: NotificationBinding) => {
    const current = capture(db, authToken)
    if (!current || JSON.stringify(current.binding) !== JSON.stringify(binding))
      throw new Error('notification_destination_changed')
    return current
  }
  return {
    capture: () => capture(db, authToken)?.binding ?? null,
    async verify(binding) {
      try {
        const current = requireBinding(binding)
        const verified = await current.live.verify(
          binding.chatId,
          current.ownerId,
          AbortSignal.timeout(10_000),
        )
        requireBinding(binding)
        return verified
      } catch {
        return false
      }
    },
    send(binding, text, signal) {
      const { live } = requireBinding(binding)
      return live.send(binding.chatId, binding.topicId, text, signal)
    },
  }
}
