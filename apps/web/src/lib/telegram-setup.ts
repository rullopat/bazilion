// What the Telegram page says about the bot and what its forms send, worked out from what the
// daemon reports. Nothing here asks Telegram anything.

import type {
  AttentionKind,
  NotificationSettings,
  NotificationSettingsResponse,
  TelegramAllowedUser,
  TelegramConfigInput,
  TelegramConfigState,
  TelegramHealth,
  TelegramPairingStatus,
  TelegramPreflight,
} from '@bazilion/api-types'
import type { Tone } from './model-facts'

/** A card's state: a few words and how loud they are. */
export interface CardState {
  label: string
  tone: Tone
}

const RUNNING: CardState = { label: 'Running', tone: 'success' }
const NOT_RUNNING: CardState = { label: 'Not running', tone: 'warning' }

/**
 * Whether the bot runs. A preflight run on this page knows best; before one, the daemon says
 * whether the bot is up and has set up its group. Null until either is known.
 */
export function botState({
  configured,
  restarting,
  health,
  ready,
}: {
  configured: boolean
  /** Credentials were saved or a restart was asked for, and nothing was checked since. */
  restarting: boolean
  /** The last preflight run on this page. */
  health: TelegramHealth | null
  /** What the daemon says without asking Telegram; undefined until it has answered. */
  ready: boolean | undefined
}): CardState | null {
  if (!configured) return { label: 'Not connected', tone: 'neutral' }
  if (restarting) return { label: 'Restarting…', tone: 'neutral' }
  if (health) {
    const polling = health.polling
    if (!polling?.running) return NOT_RUNNING
    // It polls, but Telegram refused the preflight or the bot's own last call.
    if (health.error || polling.error) return { label: 'Failing', tone: 'warning' }
    return polling.activated ? RUNNING : { label: 'Setting up the group', tone: 'warning' }
  }
  if (ready === undefined) return null
  return ready ? RUNNING : NOT_RUNNING
}

export interface Check {
  ok: boolean
  /** What was checked. */
  label: string
  /** What was found, or what to do about it. */
  detail: string
}

/** The preflight as a list: each thing the bot needs, and whether it is so. */
export function preflightChecks(preflight: TelegramPreflight): Check[] {
  const checks: Check[] = [
    {
      ok: preflight.botUsername.length > 0,
      label: 'Bot identity',
      detail: `@${preflight.botUsername}`,
    },
    {
      ok: preflight.chatTitle.length > 0,
      label: 'Supergroup reachable',
      detail: preflight.chatTitle,
    },
    {
      ok: preflight.isForum,
      label: 'Forum topics enabled',
      detail: preflight.isForum
        ? 'is_forum: true'
        : 'is_forum: false — the supergroup owner must enable Topics in group settings',
    },
    {
      ok: preflight.hasManageTopics,
      label: 'Bot has can_manage_topics',
      detail: preflight.hasManageTopics
        ? 'admin with can_manage_topics'
        : 'promote the bot to admin in the supergroup with the "Manage topics" permission',
    },
    {
      ok: preflight.privacyModeOff,
      label: 'Privacy Mode is OFF',
      detail: preflight.privacyModeOff
        ? 'can_read_all_group_messages: true'
        : 'BotFather → /mybots → select bot → Bot Settings → Group Privacy → Turn off',
    },
    {
      ok: preflight.chatIsPrivate,
      label: 'Supergroup is private',
      detail: preflight.chatIsPrivate
        ? 'no public @username'
        : 'public groups expose topic content to readers',
    },
  ]
  if (preflight.ownerPresent !== null) {
    checks.push({
      ok: preflight.ownerPresent,
      label: 'Paired owner is present',
      detail: preflight.ownerPresent
        ? 'owner membership confirmed'
        : 'owner missing — Telegram ingress is degraded',
    })
  }
  return checks
}

/** What to do when the preflight could not get past one of its calls. */
export function preflightHint(step: NonNullable<TelegramHealth['error']>['step']): string {
  switch (step) {
    case 'getMe':
      return 'The token is invalid or revoked. Re-issue it with @BotFather → /token, or paste a fresh one above.'
    case 'getChat':
      return 'The chat id either does not exist, points at a basic group (not a supergroup), or the bot is not a member. Forward any message from the supergroup to the bot to double-check the id, then add the bot to the group.'
    case 'getChatMember':
      return 'The bot is in the chat but the membership lookup failed. This usually means the bot was removed or the chat id was migrated: confirm the bot is still in the supergroup.'
  }
}

/** The outcome of the last preflight run on this page; null before one. */
export function preflightState(health: TelegramHealth | null): CardState | null {
  if (!health) return null
  if (health.error) return { label: 'Failed', tone: 'warning' }
  if (!health.preflight) return null
  const failed = preflightChecks(health.preflight).filter((check) => !check.ok).length
  if (failed === 0) return { label: 'All passed', tone: 'success' }
  return { label: failed === 1 ? '1 to put right' : `${failed} to put right`, tone: 'warning' }
}

export function pairingState(status: TelegramPairingStatus | null): CardState | null {
  if (!status) return null
  if (status.paired) return { label: 'Paired', tone: 'success' }
  return { label: status.challengeActive ? 'Waiting for the code' : 'Not paired', tone: 'warning' }
}

/** The bot has an owner: the first of the allowed users, made by pairing. */
export function hasOwner(users: readonly TelegramAllowedUser[]): boolean {
  return users.some((user) => user.role === 'owner')
}

/** Without an owner nobody gets through, whoever is on the list. */
export function allowedState(users: readonly TelegramAllowedUser[] | null): CardState | null {
  if (!users) return null
  if (!hasOwner(users)) return { label: 'Closed', tone: 'warning' }
  return { label: users.length === 1 ? '1 person' : `${users.length} people`, tone: 'neutral' }
}

/** Who an allowed user is: the label given to them, their @username, or else their id. */
export function allowedName(user: TelegramAllowedUser): string {
  return user.label ?? (user.username ? `@${user.username}` : String(user.userId))
}

export function notificationsState(
  settings: NotificationSettingsResponse | undefined,
): CardState | null {
  if (!settings) return null
  if (!settings.enabled) return { label: 'Off', tone: 'neutral' }
  return settings.telegramReady
    ? { label: 'On', tone: 'success' }
    : { label: 'Waiting for the bot', tone: 'warning' }
}

// The same shapes the daemon accepts.
const TOKEN = /^\d+:[A-Za-z0-9_-]+$/
const CHAT_ID = /^-?\d+$/

export interface CredentialsDraft {
  /** A new bot token; empty keeps the stored one. */
  token: string
  chatId: string
}

export interface CredentialsForm {
  /** Something differs from what is stored. */
  dirty: boolean
  /** What to say under a field that cannot be saved as typed. */
  problems: { token?: string; chatId?: string }
  /** The group changed, and the daemon wants the stored token typed again with it. */
  needsToken: boolean
  /** The token field is open for that: it stays open while a new group is typed. */
  tokenOpen: boolean
  /** One of the two is still empty: they are saved together. */
  incomplete: boolean
  /** What Save sends; null while there is nothing to save or something to put right. */
  body: TelegramConfigInput | null
}

/**
 * The credentials form against what is stored. The daemon takes the token and the group together
 * and never hands the token back, so a new group needs the token again.
 */
export function credentialsForm(
  stored: TelegramConfigState,
  draft: CredentialsDraft,
): CredentialsForm {
  const token = draft.token.trim()
  const chatId = draft.chatId.trim()
  const chatChanged = chatId !== stored.chatId
  const problems: CredentialsForm['problems'] = {}
  if (token && !TOKEN.test(token)) {
    problems.token = 'A token from @BotFather looks like 1234567890:ABC…'
  }
  if (chatId && !CHAT_ID.test(chatId)) {
    problems.chatId = 'A supergroup’s id is a number, like -1001234567890.'
  } else if (!chatId && stored.configured) {
    problems.chatId = 'The bot needs a group. To remove Telegram, disconnect it below.'
  }
  const sound = !problems.token && !problems.chatId
  const dirty = token !== '' || chatChanged
  const tokenOpen = hasToken(stored) && chatChanged
  const needsToken = tokenOpen && chatId !== '' && token === '' && sound
  const complete = token !== '' && chatId !== ''
  return {
    dirty,
    problems,
    needsToken,
    tokenOpen,
    incomplete: dirty && sound && !complete && !needsToken,
    body: sound && complete ? { botToken: token, chatId } : null,
  }
}

/** A bot token is stored, with or without its group. */
export function hasToken(stored: TelegramConfigState): boolean {
  return stored.botTokenPreview !== ''
}

export interface NotificationsDraft {
  enabled: boolean
  kinds: AttentionKind[]
  /** Quiet hours are kept. */
  quiet: boolean
  start: string
  end: string
  timezone: string
}

/**
 * The notifications form as stored. A home that never saved them reports UTC, where the
 * browser's own zone is the better start.
 */
export function notificationsDraft(
  settings: NotificationSettings,
  browserZone: string,
): NotificationsDraft {
  return {
    enabled: settings.enabled,
    kinds: settings.kinds,
    quiet: settings.quietHours !== null,
    start: settings.quietHours?.start ?? '22:00',
    end: settings.quietHours?.end ?? '07:00',
    timezone: settings.enabled || settings.quietHours ? settings.timezone : browserZone,
  }
}

export function notificationsBody(draft: NotificationsDraft): NotificationSettings {
  return {
    enabled: draft.enabled,
    kinds: draft.kinds,
    timezone: draft.timezone.trim(),
    quietHours: draft.quiet ? { start: draft.start, end: draft.end } : null,
  }
}

/** Whether saving would change anything; the order of the kinds is not a change. */
export function sameNotifications(a: NotificationsDraft, b: NotificationsDraft): boolean {
  const body = (draft: NotificationsDraft) => {
    const { kinds, ...rest } = notificationsBody(draft)
    return JSON.stringify({ ...rest, kinds: [...kinds].sort() })
  }
  return body(a) === body(b)
}
