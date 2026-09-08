import type { AttentionKind } from './attention.ts'

export interface NotificationQuietHours {
  start: string
  end: string
}

export interface NotificationDestination {
  /** Opaque identity of the captured owner, bot, chat and service topic. */
  id: string
  chatId: number
  topicId: number
}

export interface NotificationSettings {
  revision: number
  enabled: boolean
  restorePaused: boolean
  kinds: AttentionKind[]
  timezone: string
  quietHours: NotificationQuietHours | null
  destination: NotificationDestination | null
  eligibleAfter: number | null
  updatedAt: number
}

export interface NotificationReadiness {
  ready: boolean
  /** Fixed diagnostic code, never an API error or credential-bearing response. */
  reason: string | null
  destination: NotificationDestination | null
}

export interface NotificationSettingsResponse {
  settings: NotificationSettings
  readiness: NotificationReadiness
  diagnostic?: string | null
}

export interface NotificationSettingsInput {
  expectedRevision: number
  enabled: boolean
  kinds: AttentionKind[]
  timezone: string
  quietHours: NotificationQuietHours | null
  /** Required when enabling; must match the currently verified service destination. */
  destinationId?: string
  /** Explicitly include the open sources captured by a count preview. Otherwise future only. */
  includeOpenPreview?: string
}

export interface NotificationPreview {
  id: string
  settingsRevision: number
  destinationId: string
  kinds: AttentionKind[]
  count: number
  byKind: Record<AttentionKind, number>
  createdAt: number
  expiresAt: number
  possibleDuplicates: boolean
}

export type NotificationDeliveryState =
  | 'deferred'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'uncertain'
  | 'suppressed'

export interface NotificationReceipt {
  id: string
  sourceKind: AttentionKind
  sourceId: string
  agentId: string | null
  teamId: string | null
  destination: NotificationDestination
  state: NotificationDeliveryState
  attempts: number
  createdAt: number
  updatedAt: number
  attemptedAt: number | null
  deliveredAt: number | null
  telegramMessageId: number | null
  /** Bounded daemon diagnostic code; source content and raw errors are excluded. */
  diagnostic: string | null
}

export interface NotificationReceiptList {
  receipts: NotificationReceipt[]
  nextCursor: string | null
}

export interface NotificationRetryInput {
  expectedUpdatedAt: number
  acknowledgePossibleDuplicate: boolean
}
