import type { Attachment } from '@bazilion/api-types'
import type { CommunicationAttempt } from '../communication.ts'
import type { MediaRef } from './media.ts'

export interface TelegramIngressPayload {
  agentId: string
  text: string
  media: MediaRef | null
  chatId: number
  threadId: number
  messageId: number
}

export interface TelegramIngressAttempt extends CommunicationAttempt {
  origin: 'telegram_agent_topic'
  attemptKind: 'telegram_ingress'
  approvalPayloadKind: 'telegram_ingress'
  approvalPayload: TelegramIngressPayload
  requester: string
}

export function isTelegramIngressPayload(value: unknown): value is TelegramIngressPayload {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.agentId) ||
    typeof value.text !== 'string' ||
    !isGroupChatId(value.chatId) ||
    !isPositiveSafeInteger(value.messageId) ||
    !isAgentTopicId(value.threadId) ||
    !isMediaRef(value.media)
  ) {
    return false
  }
  return value.text.length > 0 || value.media !== null
}

export function isTelegramIngressAttempt(
  value: unknown,
  expectedAgentId?: string,
): value is TelegramIngressAttempt {
  if (!isRecord(value)) return false
  if (
    value.origin !== 'telegram_agent_topic' ||
    value.attemptKind !== 'telegram_ingress' ||
    value.approvalPayloadKind !== 'telegram_ingress' ||
    !isNonEmptyString(value.attemptId) ||
    !isNonEmptyString(value.requester) ||
    !isTelegramIngressPayload(value.approvalPayload)
  ) {
    return false
  }
  const payload = value.approvalPayload
  if (expectedAgentId !== undefined && payload.agentId !== expectedAgentId) return false
  return value.attemptId === `${payload.chatId}:${payload.messageId}`
}

export type TelegramMediaFailureKind = 'download_failed' | 'download_unavailable'

export function telegramMediaFailureTurnText(
  payload: TelegramIngressPayload,
  failure: TelegramMediaFailureKind,
): string {
  if (!payload.media) throw new Error('telegram media fallback requires an ingress media reference')
  const note =
    failure === 'download_failed'
      ? `[Telegram ${payload.media.kind} attachment could not be downloaded]`
      : `[Telegram ${payload.media.kind} attachment received (download unavailable)]`
  return payload.text ? `${payload.text}\n\n${note}` : note
}

/**
 * Prove that a queued model turn is the deterministic derivative of the exact
 * retained Telegram transport attempt. Bytes cannot be compared with a
 * Telegram file id, but their count and transport-owned metadata are bound;
 * routing is the only component that downloads those bytes.
 */
export function isTelegramIngressTurnBinding(
  attempt: TelegramIngressAttempt,
  turn: { agentId: string; message: string; attachments: readonly Attachment[] },
): boolean {
  if (!isTelegramIngressAttempt(attempt, turn.agentId)) return false
  const payload = attempt.approvalPayload
  if (!payload.media) return turn.message === payload.text && turn.attachments.length === 0

  if (turn.attachments.length === 0) {
    return (
      turn.message === telegramMediaFailureTurnText(payload, 'download_failed') ||
      turn.message === telegramMediaFailureTurnText(payload, 'download_unavailable')
    )
  }
  if (turn.attachments.length !== 1 || turn.message !== payload.text) return false
  const attachment = turn.attachments[0]
  if (!attachment) return false
  return (
    attachment.mimeType === (payload.media.mimeType ?? 'application/octet-stream') &&
    (payload.media.fileName === null
      ? attachment.name === undefined
      : attachment.name === payload.media.fileName)
  )
}

function isMediaRef(value: unknown): value is MediaRef | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return (
    ['photo', 'document', 'voice', 'audio', 'video'].includes(String(value.kind)) &&
    isNonEmptyString(value.fileId) &&
    isNullableString(value.fileName) &&
    isNullableString(value.mimeType) &&
    (value.fileSize === null || (isSafeInteger(value.fileSize) && (value.fileSize as number) >= 0))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0
}

function isGroupChatId(value: unknown): value is number {
  return isSafeInteger(value) && value < 0
}

function isAgentTopicId(value: unknown): value is number {
  // Telegram may use no thread or the phantom/general id 1 for general chat.
  // `telegram_agent_topic` is valid only after routing has excluded both.
  return isSafeInteger(value) && value > 1
}
