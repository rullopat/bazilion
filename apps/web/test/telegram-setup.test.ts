import type {
  NotificationSettingsResponse,
  TelegramAllowedUser,
  TelegramConfigState,
  TelegramHealth,
  TelegramPreflight,
} from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  allowedName,
  allowedState,
  botState,
  credentialsForm,
  hasOwner,
  notificationsBody,
  notificationsDraft,
  notificationsState,
  pairingState,
  preflightChecks,
  preflightState,
  sameNotifications,
} from '../src/lib/telegram-setup.ts'

const preflight: TelegramPreflight = {
  botUsername: 'paperboat_bot',
  chatTitle: 'Paperboat agents',
  isForum: true,
  hasManageTopics: true,
  privacyModeOff: true,
  chatIsPrivate: true,
  memberCount: 3,
  ownerPresent: true,
}
const polling = {
  running: true,
  activated: true,
  lastUpdateId: 7,
  lastSuccessfulPollAt: 1,
  startedAt: 1,
  error: null,
}
const health = (more: Partial<TelegramHealth> = {}): TelegramHealth => ({
  configured: true,
  preflight,
  error: null,
  polling,
  ...more,
})

test('the bot’s state comes from the last preflight, else from what the daemon knows', () => {
  const known = { configured: true, restarting: false, health: null, ready: true }
  expect(botState({ ...known, configured: false })).toEqual({
    label: 'Not connected',
    tone: 'neutral',
  })
  expect(botState(known)).toEqual({ label: 'Running', tone: 'success' })
  expect(botState({ ...known, ready: false })).toEqual({ label: 'Not running', tone: 'warning' })
  // Nothing is claimed before the daemon has answered.
  expect(botState({ ...known, ready: undefined })).toBeNull()
  // A restart was asked for: what was known is about the bot that is going away.
  expect(botState({ ...known, restarting: true })?.label).toBe('Restarting…')

  // A preflight run on the page outranks the daemon's earlier word.
  expect(botState({ ...known, ready: false, health: health() })?.label).toBe('Running')
  expect(botState({ ...known, health: health({ polling: null }) })?.label).toBe('Not running')
  expect(
    botState({ ...known, health: health({ polling: { ...polling, running: false } }) })?.label,
  ).toBe('Not running')
  expect(
    botState({ ...known, health: health({ polling: { ...polling, activated: false } }) }),
  ).toEqual({ label: 'Setting up the group', tone: 'warning' })
  // It polls, but something is refused: neither "running" nor "setting up" would be true.
  expect(
    botState({
      ...known,
      health: health({ polling: { ...polling, activated: false, error: 'no rights' } }),
    })?.label,
  ).toBe('Failing')
  expect(
    botState({
      ...known,
      health: health({ preflight: null, error: { step: 'getMe', message: 'Unauthorized' } }),
    })?.label,
  ).toBe('Failing')
})

test('a preflight is a list of checks, and its state counts what is left to put right', () => {
  expect(preflightChecks(preflight).map((check) => [check.label, check.ok])).toEqual([
    ['Bot identity', true],
    ['Supergroup reachable', true],
    ['Forum topics enabled', true],
    ['Bot has can_manage_topics', true],
    ['Privacy Mode is OFF', true],
    ['Supergroup is private', true],
    ['Paired owner is present', true],
  ])
  // Nobody is paired yet: whether the owner is in the group is not a question.
  expect(preflightChecks({ ...preflight, ownerPresent: null })).toHaveLength(6)
  const broken = { ...preflight, isForum: false, privacyModeOff: false }
  expect(preflightChecks(broken).find((check) => check.label === 'Forum topics enabled')).toEqual({
    ok: false,
    label: 'Forum topics enabled',
    detail: 'is_forum: false — the supergroup owner must enable Topics in group settings',
  })

  expect(preflightState(null)).toBeNull()
  expect(preflightState(health())).toEqual({ label: 'All passed', tone: 'success' })
  expect(preflightState(health({ preflight: broken }))).toEqual({
    label: '2 to put right',
    tone: 'warning',
  })
  expect(preflightState(health({ preflight: { ...preflight, isForum: false } }))?.label).toBe(
    '1 to put right',
  )
  expect(
    preflightState(health({ preflight: null, error: { step: 'getChat', message: 'not found' } })),
  ).toEqual({ label: 'Failed', tone: 'warning' })
  expect(preflightState(health({ preflight: null }))).toBeNull()
})

test('pairing and the allowed users say who gets through', () => {
  const status = {
    paired: false,
    challengeActive: false,
    challengeExpiresAt: null,
    ownerUserId: null,
  }
  expect(pairingState(null)).toBeNull()
  expect(pairingState(status)).toEqual({ label: 'Not paired', tone: 'warning' })
  expect(pairingState({ ...status, challengeActive: true })?.label).toBe('Waiting for the code')
  expect(pairingState({ ...status, paired: true, ownerUserId: 5 })).toEqual({
    label: 'Paired',
    tone: 'success',
  })

  const user = (more: Partial<TelegramAllowedUser>): TelegramAllowedUser => ({
    userId: 584201773,
    username: null,
    label: null,
    role: 'member',
    addedAt: 0,
    ...more,
  })
  const owner = user({ role: 'owner', label: 'Pat', username: 'pat_r' })
  expect(allowedName(owner)).toBe('Pat')
  expect(allowedName(user({ username: 'mira_dev' }))).toBe('@mira_dev')
  expect(allowedName(user({}))).toBe('584201773')

  expect(allowedState(null)).toBeNull()
  expect(allowedState([])).toEqual({ label: 'Closed', tone: 'warning' })
  expect(allowedState([owner])).toEqual({ label: '1 person', tone: 'neutral' })
  expect(allowedState([owner, user({ userId: 2 })])?.label).toBe('2 people')
  // Without an owner nobody gets through, whoever is on the list.
  expect(hasOwner([user({})])).toBe(false)
  expect(allowedState([user({})])?.label).toBe('Closed')
})

test('the credentials are saved together, and a new group needs the token again', () => {
  const none: TelegramConfigState = {
    configured: false,
    chatId: '',
    botTokenPreview: '',
    migratedChatId: null,
  }
  const stored: TelegramConfigState = {
    configured: true,
    chatId: '-1001234567890',
    botTokenPreview: '1234567:AAHi…',
    migratedChatId: null,
  }
  const token = '1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'

  expect(credentialsForm(none, { token: '', chatId: '' })).toEqual({
    dirty: false,
    problems: {},
    needsToken: false,
    tokenOpen: false,
    incomplete: false,
    body: null,
  })
  // One of the two is not enough, and the form says so instead of only refusing.
  expect(credentialsForm(none, { token, chatId: '' })).toMatchObject({
    dirty: true,
    incomplete: true,
    body: null,
  })
  expect(credentialsForm(none, { token: '', chatId: '-100123' })).toMatchObject({
    incomplete: true,
    needsToken: false,
    body: null,
  })
  expect(credentialsForm(none, { token: ` ${token} `, chatId: ' -1001234567890 ' }).body).toEqual({
    botToken: token,
    chatId: '-1001234567890',
  })
  // The shapes the daemon would refuse are said under the field first.
  expect(credentialsForm(none, { token: 'not a token', chatId: 'my group' })).toMatchObject({
    problems: {
      token: 'A token from @BotFather looks like 1234567890:ABC…',
      chatId: 'A supergroup’s id is a number, like -1001234567890.',
    },
    incomplete: false,
    body: null,
  })

  // Nothing typed: nothing to save.
  expect(credentialsForm(stored, { token: '', chatId: stored.chatId })).toMatchObject({
    dirty: false,
    needsToken: false,
    body: null,
  })
  // The daemon never hands the token back, so a new group cannot be saved without it.
  expect(credentialsForm(stored, { token: '', chatId: '-1009876543210' })).toMatchObject({
    dirty: true,
    needsToken: true,
    tokenOpen: true,
    incomplete: false,
    body: null,
  })
  // The field it is typed into stays open while it is typed, and while the group is typed.
  expect(credentialsForm(stored, { token: '1', chatId: '-1009876543210' })).toMatchObject({
    needsToken: false,
    tokenOpen: true,
  })
  expect(credentialsForm(stored, { token: '', chatId: '-' })).toMatchObject({
    needsToken: false,
    tokenOpen: true,
  })
  // The group put back: nothing to ask for.
  expect(credentialsForm(stored, { token: '', chatId: stored.chatId }).tokenOpen).toBe(false)
  expect(credentialsForm(stored, { token, chatId: '-1009876543210' }).body).toEqual({
    botToken: token,
    chatId: '-1009876543210',
  })
  // A new token for the same group.
  expect(credentialsForm(stored, { token, chatId: stored.chatId }).body).toEqual({
    botToken: token,
    chatId: stored.chatId,
  })
  // Emptying the group is not how Telegram is removed.
  expect(credentialsForm(stored, { token: '', chatId: '' })).toMatchObject({
    problems: { chatId: 'The bot needs a group. To remove Telegram, disconnect it below.' },
    needsToken: false,
    body: null,
  })
  // A token stored without its group: the group alone still needs the token typed.
  const half = { ...none, botTokenPreview: '1234567:AAHi…' }
  expect(credentialsForm(half, { token: '', chatId: '-100123' })).toMatchObject({
    needsToken: true,
    body: null,
  })
})

test('the notifications form starts from what is stored and sends what the daemon stores', () => {
  const never: NotificationSettingsResponse = {
    enabled: false,
    kinds: ['review_failure', 'trigger_failure'],
    timezone: 'UTC',
    quietHours: null,
    telegramReady: false,
  }
  // A home that never saved them reports UTC: the browser's zone is the better start.
  const fresh = notificationsDraft(never, 'Europe/Warsaw')
  expect(fresh).toEqual({
    enabled: false,
    kinds: ['review_failure', 'trigger_failure'],
    quiet: false,
    start: '22:00',
    end: '07:00',
    timezone: 'Europe/Warsaw',
  })
  // That start is not a change to be saved.
  expect(sameNotifications(fresh, notificationsDraft(never, 'Europe/Warsaw'))).toBe(true)

  const saved: NotificationSettingsResponse = {
    ...never,
    enabled: true,
    timezone: 'America/Lima',
    quietHours: { start: '23:30', end: '06:15' },
    telegramReady: true,
  }
  const draft = notificationsDraft(saved, 'Europe/Warsaw')
  expect(draft).toMatchObject({
    quiet: true,
    start: '23:30',
    end: '06:15',
    timezone: 'America/Lima',
  })
  expect(notificationsBody(draft)).toEqual({
    enabled: true,
    kinds: ['review_failure', 'trigger_failure'],
    timezone: 'America/Lima',
    quietHours: { start: '23:30', end: '06:15' },
  })
  expect(notificationsBody({ ...draft, quiet: false }).quietHours).toBeNull()

  // The order in which kinds were ticked is not a change; a different set is.
  expect(sameNotifications(draft, { ...draft, kinds: ['trigger_failure', 'review_failure'] })).toBe(
    true,
  )
  expect(sameNotifications(draft, { ...draft, kinds: ['review_failure'] })).toBe(false)
  expect(sameNotifications(draft, { ...draft, end: '07:00' })).toBe(false)
  expect(sameNotifications(draft, { ...draft, enabled: false })).toBe(false)

  expect(notificationsState(undefined)).toBeNull()
  expect(notificationsState(never)).toEqual({ label: 'Off', tone: 'neutral' })
  expect(notificationsState(saved)).toEqual({ label: 'On', tone: 'success' })
  // Switched on while the bot is down: nothing goes out yet, and the chip does not say "On".
  expect(notificationsState({ ...saved, telegramReady: false })).toEqual({
    label: 'Waiting for the bot',
    tone: 'warning',
  })
})
