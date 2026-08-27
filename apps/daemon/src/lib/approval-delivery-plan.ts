import type {
  Attachment,
  ChatFrame,
  CommunicationApprovalDetail,
  Message,
  ToolResultImage,
} from '@bazilion/api-types'
import {
  isTelegramIngressPayload,
  type TelegramIngressPayload,
} from './telegram/ingress-attempt.ts'

export interface AgentTurnApprovalPayload {
  agentId: string
  message: string
  attachments: Attachment[]
}

export interface SchedulerTriggerApprovalPayload {
  dispatchId: string
  triggerId: string
  occurrence: number
  agentId: string
  message: string
}

export interface AgentMessageApprovalPayload {
  from: string
  to: string
  payload: string
  replyTo?: string | null
  causalParentMessageId?: string | null
}

export interface InboxMessageApprovalPayload {
  messageId: string
}

export interface HttpChatFrameApprovalPayload {
  agentId: string
  frame: ChatFrame
}

interface TelegramTransportPayload {
  chatId: number
  topicId?: number
}

export interface TelegramTextApprovalPayload extends TelegramTransportPayload {
  text: string
  parseMode: 'HTML' | null
}

export type TelegramTypingApprovalPayload = TelegramTransportPayload

export interface TelegramImageApprovalPayload extends TelegramTransportPayload {
  data: string
  mimeType: string
  caption?: string
  asDocument?: boolean
}

export interface TelegramFileApprovalPayload extends TelegramTransportPayload {
  data: string
  mimeType: string
  name: string
  caption?: string
}

export type ApprovalDeliveryPlan =
  | {
      kind: 'agent_turn'
      approval: CommunicationApprovalDetail
      payload: AgentTurnApprovalPayload
    }
  | {
      kind: 'telegram_ingress'
      approval: CommunicationApprovalDetail
      payload: TelegramIngressPayload
    }
  | {
      kind: 'scheduler_trigger'
      approval: CommunicationApprovalDetail
      payload: SchedulerTriggerApprovalPayload
    }
  | {
      kind: 'inbox_message'
      approval: CommunicationApprovalDetail
      payload: InboxMessageApprovalPayload
      message: Message
    }
  | {
      kind: 'agent_message'
      approval: CommunicationApprovalDetail
      payload: AgentMessageApprovalPayload
    }
  | {
      kind: 'http_chat_frame'
      approval: CommunicationApprovalDetail
      payload: HttpChatFrameApprovalPayload
    }
  | {
      kind: 'telegram_text'
      approval: CommunicationApprovalDetail
      payload: TelegramTextApprovalPayload
    }
  | {
      kind: 'telegram_typing'
      approval: CommunicationApprovalDetail
      payload: TelegramTypingApprovalPayload
    }
  | {
      kind: 'telegram_image'
      approval: CommunicationApprovalDetail
      payload: TelegramImageApprovalPayload
    }
  | {
      kind: 'telegram_file'
      approval: CommunicationApprovalDetail
      payload: TelegramFileApprovalPayload
    }

export interface ApprovalDeliveryPlanContext {
  messageById?: (messageId: string) => Message | null
}

export class ApprovalDeliveryValidationError extends Error {
  constructor(readonly code: string) {
    super(`approval_delivery_invalid: ${code}`)
    this.name = 'ApprovalDeliveryValidationError'
  }
}

/**
 * Validate the complete durable delivery tuple before its guarded effect. The
 * allowlist is deliberately closed: adding a payload handler without adding
 * its operation/origin contract here cannot make an approval executable.
 */
export function planApprovalDelivery(
  approval: CommunicationApprovalDetail,
  context: ApprovalDeliveryPlanContext = {},
): ApprovalDeliveryPlan {
  if (!isNonEmptyString(approval.attemptId)) invalid('attempt_id')

  if (
    approval.operation === 'user_to_agent' &&
    approval.payloadKind === 'agent_turn' &&
    approval.origin === 'http_chat'
  ) {
    requireAttemptKind(approval, 'http_chat_ingress')
    const payload = requireAgentTurnPayload(approval.payload)
    requireUserToAgent(approval, payload.agentId)
    return { kind: 'agent_turn', approval, payload }
  }

  if (
    approval.operation === 'user_to_agent' &&
    approval.payloadKind === 'telegram_ingress' &&
    approval.origin === 'telegram_agent_topic'
  ) {
    requireAttemptKind(approval, 'telegram_ingress')
    if (!isTelegramIngressPayload(approval.payload)) invalid('telegram_ingress_payload')
    const payload = approval.payload
    requireUserToAgent(approval, payload.agentId)
    if (approval.attemptId !== `${payload.chatId}:${payload.messageId}`)
      invalid('telegram_ingress_attempt')
    return { kind: 'telegram_ingress', approval, payload }
  }

  if (
    approval.operation === 'scheduler_trigger' &&
    approval.payloadKind === 'scheduler_trigger' &&
    approval.origin === 'scheduler_trigger'
  ) {
    requireAttemptKind(approval, 'scheduler_trigger')
    const payload = requireSchedulerPayload(approval.payload)
    requireUserToAgent(approval, payload.agentId)
    if (approval.attemptId !== `${payload.triggerId}:${payload.occurrence}`)
      invalid('scheduler_trigger_attempt')
    return { kind: 'scheduler_trigger', approval, payload }
  }

  if (
    approval.operation === 'deliver_agent_message' &&
    approval.payloadKind === 'inbox_message' &&
    (approval.origin === 'agent_inbox' || approval.origin === 'scheduler_inbox')
  ) {
    requireAttemptKind(approval, 'inbox')
    const payload = requireInboxPayload(approval.payload)
    if (approval.attemptId !== payload.messageId) invalid('inbox_message_attempt')
    const message = context.messageById?.(payload.messageId)
    if (!message) invalid('inbox_message_missing')
    requireAgentToAgent(approval, message.fromAgentId, message.toAgentId)
    return { kind: 'inbox_message', approval, payload, message }
  }

  if (
    approval.operation === 'send_agent_message' &&
    approval.payloadKind === 'agent_message' &&
    (approval.origin === 'agent_tool' || approval.origin === 'http_agent_message')
  ) {
    requireAttemptKind(approval, approval.origin)
    const payload = requireAgentMessagePayload(approval.payload)
    requireAgentToAgent(approval, payload.from, payload.to)
    return { kind: 'agent_message', approval, payload }
  }

  if (
    approval.operation === 'agent_to_user' &&
    approval.payloadKind === 'http_chat_frame' &&
    approval.origin === 'http_chat'
  ) {
    requireAttemptKind(approval, 'http_chat_frame')
    const payload = requireHttpChatFramePayload(approval.payload)
    requireAgentToUser(approval, payload.agentId)
    return { kind: 'http_chat_frame', approval, payload }
  }

  if (
    approval.operation === 'agent_to_user' &&
    approval.origin === 'telegram_mirror' &&
    approval.payloadKind === 'telegram_text'
  ) {
    requireAttemptKind(approval, 'telegram_egress')
    requireAgentToUser(approval)
    return {
      kind: 'telegram_text',
      approval,
      payload: requireTelegramTextPayload(approval.payload),
    }
  }

  if (
    approval.operation === 'agent_to_user' &&
    approval.origin === 'telegram_mirror' &&
    approval.payloadKind === 'telegram_typing'
  ) {
    requireAttemptKind(approval, 'telegram_egress')
    requireAgentToUser(approval)
    return {
      kind: 'telegram_typing',
      approval,
      payload: requireTelegramTransportPayload(approval.payload),
    }
  }

  if (
    approval.operation === 'agent_to_user' &&
    approval.origin === 'telegram_mirror' &&
    approval.payloadKind === 'telegram_image'
  ) {
    requireAttemptKind(approval, 'telegram_egress')
    requireAgentToUser(approval)
    return {
      kind: 'telegram_image',
      approval,
      payload: requireTelegramImagePayload(approval.payload),
    }
  }

  if (
    approval.operation === 'agent_to_user' &&
    approval.origin === 'telegram_mirror' &&
    approval.payloadKind === 'telegram_file'
  ) {
    requireAttemptKind(approval, 'telegram_egress')
    requireAgentToUser(approval)
    return {
      kind: 'telegram_file',
      approval,
      payload: requireTelegramFilePayload(approval.payload),
    }
  }

  return invalid('tuple_not_allowed')
}

function requireAttemptKind(approval: CommunicationApprovalDetail, expected: string): void {
  if (approval.attemptKind !== expected) invalid('attempt_kind')
}

function requireUserToAgent(approval: CommunicationApprovalDetail, agentId: string): void {
  if (
    approval.source.kind !== 'user' ||
    approval.target.kind !== 'agent' ||
    approval.target.id !== agentId ||
    approval.channel !== 'user' ||
    !isNonEmptyString(approval.source.teamId) ||
    approval.sourceTeamId !== approval.source.teamId ||
    approval.targetTeamId !== approval.source.teamId
  ) {
    invalid('user_to_agent_endpoints')
  }
}

function requireAgentToUser(approval: CommunicationApprovalDetail, agentId?: string): void {
  if (
    approval.source.kind !== 'agent' ||
    (agentId !== undefined && approval.source.id !== agentId) ||
    approval.target.kind !== 'user' ||
    approval.channel !== 'user' ||
    !isNonEmptyString(approval.target.teamId) ||
    approval.sourceTeamId !== approval.target.teamId ||
    approval.targetTeamId !== approval.target.teamId
  ) {
    invalid('agent_to_user_endpoints')
  }
}

function requireAgentToAgent(
  approval: CommunicationApprovalDetail,
  sourceId: string,
  targetId: string,
): void {
  if (
    approval.source.kind !== 'agent' ||
    approval.source.id !== sourceId ||
    approval.target.kind !== 'agent' ||
    approval.target.id !== targetId ||
    !isNonEmptyString(approval.sourceTeamId) ||
    !isNonEmptyString(approval.targetTeamId) ||
    !['same_team', 'cross_team'].includes(approval.channel) ||
    (approval.channel === 'same_team' && approval.sourceTeamId !== approval.targetTeamId) ||
    (approval.channel === 'cross_team' && approval.sourceTeamId === approval.targetTeamId)
  ) {
    invalid('agent_to_agent_endpoints')
  }
}

function requireAgentTurnPayload(value: unknown): AgentTurnApprovalPayload {
  if (!isRecord(value) || !isNonEmptyString(value.agentId) || typeof value.message !== 'string')
    return invalid('agent_turn_payload')
  if (!Array.isArray(value.attachments) || !value.attachments.every(isAttachment))
    return invalid('agent_turn_attachments')
  if (value.message.length === 0 && value.attachments.length === 0)
    return invalid('agent_turn_empty')
  return {
    agentId: value.agentId,
    message: value.message,
    attachments: value.attachments,
  }
}

function requireSchedulerPayload(value: unknown): SchedulerTriggerApprovalPayload {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.dispatchId) ||
    !isNonEmptyString(value.triggerId) ||
    !isSafeInteger(value.occurrence) ||
    !isNonEmptyString(value.agentId) ||
    typeof value.message !== 'string'
  ) {
    return invalid('scheduler_trigger_payload')
  }
  return {
    dispatchId: value.dispatchId,
    triggerId: value.triggerId,
    occurrence: value.occurrence,
    agentId: value.agentId,
    message: value.message,
  }
}

function requireInboxPayload(value: unknown): InboxMessageApprovalPayload {
  if (!isRecord(value) || !isNonEmptyString(value.messageId))
    return invalid('inbox_message_payload')
  return { messageId: value.messageId }
}

function requireAgentMessagePayload(value: unknown): AgentMessageApprovalPayload {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.from) ||
    !isNonEmptyString(value.to) ||
    typeof value.payload !== 'string' ||
    !isOptionalNullableString(value.replyTo) ||
    !isOptionalNullableString(value.causalParentMessageId)
  ) {
    return invalid('agent_message_payload')
  }
  return {
    from: value.from,
    to: value.to,
    payload: value.payload,
    ...(value.replyTo !== undefined ? { replyTo: value.replyTo } : {}),
    ...(value.causalParentMessageId !== undefined
      ? { causalParentMessageId: value.causalParentMessageId }
      : {}),
  }
}

function requireHttpChatFramePayload(value: unknown): HttpChatFrameApprovalPayload {
  if (!isRecord(value) || !isNonEmptyString(value.agentId) || !isChatFrame(value.frame))
    return invalid('http_chat_frame_payload')
  return { agentId: value.agentId, frame: value.frame }
}

function requireTelegramTransportPayload(value: unknown): TelegramTransportPayload {
  if (
    !isRecord(value) ||
    !isSafeInteger(value.chatId) ||
    (value.topicId !== undefined && !isPositiveSafeInteger(value.topicId))
  ) {
    return invalid('telegram_transport_payload')
  }
  return {
    chatId: value.chatId,
    ...(value.topicId !== undefined ? { topicId: value.topicId } : {}),
  }
}

function requireTelegramTextPayload(value: unknown): TelegramTextApprovalPayload {
  const transport = requireTelegramTransportPayload(value)
  if (!isRecord(value) || typeof value.text !== 'string') return invalid('telegram_text_payload')
  if (value.parseMode !== null && value.parseMode !== 'HTML')
    return invalid('telegram_text_parse_mode')
  return { ...transport, text: value.text, parseMode: value.parseMode }
}

function requireTelegramImagePayload(value: unknown): TelegramImageApprovalPayload {
  const transport = requireTelegramTransportPayload(value)
  if (
    !isRecord(value) ||
    !isBase64(value.data) ||
    !isNonEmptyString(value.mimeType) ||
    !isOptionalString(value.caption) ||
    (value.asDocument !== undefined && typeof value.asDocument !== 'boolean')
  ) {
    return invalid('telegram_image_payload')
  }
  return {
    ...transport,
    data: value.data,
    mimeType: value.mimeType,
    ...(value.caption !== undefined ? { caption: value.caption } : {}),
    ...(value.asDocument !== undefined ? { asDocument: value.asDocument } : {}),
  }
}

function requireTelegramFilePayload(value: unknown): TelegramFileApprovalPayload {
  const transport = requireTelegramTransportPayload(value)
  if (
    !isRecord(value) ||
    !isBase64(value.data) ||
    !isNonEmptyString(value.mimeType) ||
    !isNonEmptyString(value.name) ||
    !isOptionalString(value.caption)
  ) {
    return invalid('telegram_file_payload')
  }
  return {
    ...transport,
    data: value.data,
    mimeType: value.mimeType,
    name: value.name,
    ...(value.caption !== undefined ? { caption: value.caption } : {}),
  }
}

function isChatFrame(value: unknown): value is ChatFrame {
  if (!isRecord(value)) return false
  if (value.kind === 'fatal') return typeof value.error === 'string'
  if (value.kind !== 'event' || !isRecord(value.event)) return false
  const event = value.event
  if (event.type === 'assistant_message') return typeof event.text === 'string'
  if (event.type === 'assistant_delta') return typeof event.delta === 'string'
  if (event.type === 'error') return typeof event.error === 'string'
  if (event.type === 'file') {
    return isNonEmptyString(event.name) && isNonEmptyString(event.mimeType) && isBase64(event.data)
  }
  if (event.type === 'tool_result') {
    return (
      isNonEmptyString(event.id) &&
      isNonEmptyString(event.name) &&
      typeof event.result === 'string' &&
      Array.isArray(event.images) &&
      event.images.length > 0 &&
      event.images.every(isToolResultImage)
    )
  }
  return false
}

function isAttachment(value: unknown): value is Attachment {
  return (
    isRecord(value) &&
    isOptionalString(value.name) &&
    isNonEmptyString(value.mimeType) &&
    isBase64(value.data)
  )
}

function isToolResultImage(value: unknown): value is ToolResultImage {
  return isRecord(value) && isNonEmptyString(value.mimeType) && isBase64(value.data)
}

function isBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0
}

function invalid(code: string): never {
  throw new ApprovalDeliveryValidationError(code)
}
