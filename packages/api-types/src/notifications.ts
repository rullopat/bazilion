import type { AttentionKind } from './attention.ts'

export interface NotificationQuietHours {
  /** HH:mm on the 24-hour clock, in the settings' timezone. */
  start: string
  end: string
}

/** Telegram attention notifications: new open Attention items go to the bot's service topic. */
export interface NotificationSettings {
  enabled: boolean
  kinds: AttentionKind[]
  /** IANA timezone for quiet hours. */
  timezone: string
  quietHours: NotificationQuietHours | null
}

export interface NotificationSettingsResponse extends NotificationSettings {
  /** True while the Telegram bot is running and its service topic exists. */
  telegramReady: boolean
}
