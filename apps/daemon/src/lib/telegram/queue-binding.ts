import { createHash } from 'node:crypto'
import type { BazilionDb } from '../../core/db/client.ts'
import { mergeSecretsIntoEnv } from '../../core/index.ts'
import type { BoundAgentTurn } from '../turn-invocation.ts'
import {
  isTelegramIngressAttempt,
  isTelegramIngressTurnBinding,
  type TelegramIngressAttempt,
} from './ingress-attempt.ts'

export interface TelegramQueueBinding {
  authorization: TelegramIngressAttempt
  ownerGrantId: string
  topicBindingId: string
  botDigest: string
  teamId: string
}

/** Capture the live owner/topic/credential identity; no bot credential is persisted in input. */
export function captureTelegramQueueBinding(
  db: BazilionDb,
  authToken: string,
  authorization: TelegramIngressAttempt,
  transportBotToken?: string,
): TelegramQueueBinding {
  if (!isTelegramIngressAttempt(authorization)) throw new Error('Invalid Telegram queue attempt')
  const payload = authorization.approvalPayload
  const owner = db.raw
    .query<{ user_id: number; grant_id: string }, []>(
      "SELECT user_id, grant_id FROM telegram_allowed_users WHERE role = 'owner' ORDER BY added_at LIMIT 1",
    )
    .get()
  const agent = db.raw
    .query<
      {
        telegram_topic_id: number | null
        telegram_binding_id: string
        status: string
        team_id: string
      },
      [string]
    >('SELECT telegram_topic_id, telegram_binding_id, status, team_id FROM agents WHERE id = ?')
    .get(payload.agentId)
  const config = mergeSecretsIntoEnv(db, authToken)
  const botToken = config.TELEGRAM_BOT_TOKEN
  const credential = db.raw
    .query<{ envelope: string }, []>(
      "SELECT envelope FROM secrets WHERE key = 'TELEGRAM_BOT_TOKEN'",
    )
    .get()
  if (
    !owner ||
    authorization.requester !== `telegram:${owner.user_id}` ||
    !agent ||
    agent.status === 'archived' ||
    agent.telegram_topic_id !== payload.threadId ||
    Number(config.TELEGRAM_CHAT_ID) !== payload.chatId ||
    !botToken ||
    (transportBotToken !== undefined && botToken !== transportBotToken)
  )
    throw new Error('Telegram queue owner, topic or credential is unavailable')
  return {
    authorization,
    teamId: agent.team_id,
    ownerGrantId: owner.grant_id,
    topicBindingId: agent.telegram_binding_id,
    botDigest: createHash('sha256')
      .update(JSON.stringify([botToken, credential?.envelope ?? null]))
      .digest('hex'),
  }
}

export function requireTelegramQueueBinding(
  db: BazilionDb,
  authToken: string,
  value: unknown,
): TelegramQueueBinding {
  if (!value || typeof value !== 'object') throw new Error('Telegram queue binding unavailable')
  const saved = value as Partial<TelegramQueueBinding>
  if (!isTelegramIngressAttempt(saved.authorization))
    throw new Error('Telegram queue attempt unavailable')
  const current = captureTelegramQueueBinding(db, authToken, saved.authorization)
  if (
    saved.ownerGrantId !== current.ownerGrantId ||
    saved.teamId !== current.teamId ||
    saved.topicBindingId !== current.topicBindingId ||
    saved.botDigest !== current.botDigest
  )
    throw new Error('Telegram queue binding changed after acceptance')
  return current
}

export function requireTelegramQueuedTurn(
  db: BazilionDb,
  authToken: string,
  value: unknown,
  turn: BoundAgentTurn,
): TelegramQueueBinding {
  const binding = requireTelegramQueueBinding(db, authToken, value)
  if (
    !isTelegramIngressTurnBinding(binding.authorization, turn) ||
    (binding.authorization.approvalPayload.media && turn.attachments.length === 0)
  )
    throw new Error('Telegram queued input is incomplete or differs from its transport attempt')
  const expectedSize = binding.authorization.approvalPayload.media?.fileSize
  if (
    expectedSize !== null &&
    expectedSize !== undefined &&
    Buffer.from(turn.attachments[0]?.data ?? '', 'base64').byteLength !== expectedSize
  )
    throw new Error('Telegram queued attachment size differs from its transport attempt')
  return binding
}
