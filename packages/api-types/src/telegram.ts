import type { Agent, TelegramAclRole } from './entities.ts'

/** Body for `PUT /api/config/telegram`; the token goes to `secrets`, the chat id to `config`. */
export interface TelegramConfigInput {
  /** Bot token from BotFather (TELEGRAM_BOT_TOKEN). */
  botToken: string
  /** Supergroup numeric chat id (TELEGRAM_CHAT_ID). */
  chatId: string
}

/** `GET /api/config/telegram`: what is stored, with the bot token masked. */
export interface TelegramConfigState {
  /** True iff both botToken and chatId are present in storage. */
  configured: boolean
  /** Plaintext chat id (empty string when unset). */
  chatId: string
  /** Masked preview of the bot token like `1234567:AAHi…`. Empty when unset. */
  botTokenPreview: string
  /**
   * The chat id Telegram announced when the group became a supergroup, until
   * `POST /api/config/telegram/reconnect` switches to it. Null when none is pending.
   */
  migratedChatId: string | null
}

/** The setup checks that must all pass before the bot is usable. One-shot calls, no polling. */
export interface TelegramPreflight {
  /** Bot identity from getMe. Username has no leading `@`. */
  botUsername: string
  /** Display name of the supergroup, from getChat. */
  chatTitle: string
  /** True iff the chat has forum topics enabled (the irreversible owner-only toggle). */
  isForum: boolean
  /** True iff the bot is admin in the supergroup with the can_manage_topics right. */
  hasManageTopics: boolean
  /** True iff Privacy Mode is OFF (getMe.can_read_all_group_messages). */
  privacyModeOff: boolean
  /** True when getChat reports no public @username. */
  chatIsPrivate: boolean
  /** Telegram's current member count, used as a visibility warning only. */
  memberCount: number | null
  /** Paired owner is currently reported as a chat member. Null while unpaired. */
  ownerPresent: boolean | null
}

/**
 * The running bot. `lastSuccessfulPollAt` is the last `getUpdates` that succeeded; `error` is the
 * latest polling or activation failure, cleared by the next successful poll; `activated` turns
 * true once the bot has set up the group (service topic, pinned directory, command menu).
 */
export interface TelegramPollingState {
  running: boolean
  activated: boolean
  lastUpdateId: number | null
  lastSuccessfulPollAt: number | null
  startedAt: number | null
  error: string | null
}

/**
 * `GET /api/config/telegram/health`. Without credentials `configured` is false and `preflight`
 * null; a failed setup call leaves `preflight` null and names the step in `error`. `polling` is
 * null while no bot runs.
 */
export interface TelegramHealth {
  configured: boolean
  preflight: TelegramPreflight | null
  error: {
    step: 'getMe' | 'getChat' | 'getChatMember'
    message: string
  } | null
  polling: TelegramPollingState | null
}

export interface TelegramPairingStatus {
  paired: boolean
  challengeActive: boolean
  challengeExpiresAt: number | null
  ownerUserId: number | null
}

export interface TelegramPairingChallenge extends TelegramPairingStatus {
  /** One-time plaintext. Returned only by challenge creation. */
  code: string
  expiresAt: number
}

/** Body for `POST /api/config/telegram/acl` — add a user to the allowlist. */
export interface AddTelegramAllowedUserRequest {
  userId: number
  username?: string | null
  label?: string | null
  /** Defaults to 'member' when omitted. */
  role?: TelegramAclRole
}

/**
 * `POST /api/agents/:id/telegram/bind`: the agent with its topic bound, a deep link to the topic,
 * and whether the topic was created now or already existed.
 */
export interface TelegramBindResponse {
  agent: Agent
  topicId: number
  deepLink: string
  created: boolean
}

/** Body for `PUT /api/teams/:id/topic-format`; null or blank restores built-in topic names. */
export interface SetTeamTopicFormatRequest {
  format: string | null
}
