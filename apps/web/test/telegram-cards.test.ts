// What the Telegram cards put on the page for what the daemon reports. The cards that load
// for themselves (pairing, allowed users) are walked in a browser.
import type { TelegramConfigState, TelegramHealth } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { NotificationsCard } from '../src/components/setup/NotificationsCard.tsx'
import { BotCard } from '../src/components/setup/telegram/BotCard.tsx'
import { PreflightCard } from '../src/components/setup/telegram/PreflightCard.tsx'

const done = async () => {}
const nothing = () => {}

function bot(stored: TelegramConfigState, state: { label: string; tone: 'success' | 'neutral' }) {
  return renderToStaticMarkup(
    createElement(BotCard, {
      stored,
      state,
      justSaved: false,
      onSaved: done,
      onDisconnected: done,
    }),
  )
}

test('before Telegram is connected the bot card asks for both credentials and offers no disconnect', () => {
  const html = bot(
    { configured: false, chatId: '', botTokenPreview: '', migratedChatId: null },
    { label: 'Not connected', tone: 'neutral' },
  )
  expect(html).toContain('Not connected')
  expect(html).toContain('type="password"')
  expect(html).toContain('placeholder="-1001234567890"')
  expect(html).toContain('Saving starts the bot.')
  expect(html).not.toContain('Disconnect Telegram')
  // Nothing to save yet.
  expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
})

test('a connected bot shows that a token is saved, never the token, and can be disconnected', () => {
  const html = bot(
    {
      configured: true,
      chatId: '-1001234567890',
      botTokenPreview: '1234567:AAHi…',
      migratedChatId: null,
    },
    { label: 'Running', tone: 'success' },
  )
  expect(html).toContain('Running')
  expect(html).toContain('Saved: <span class="font-mono">1234567:AAHi…</span>, stored encrypted')
  expect(html).not.toContain('type="password"')
  expect(html).toContain('value="-1001234567890"')
  expect(html).toContain('>Replace<')
  // The token goes with a disconnect, not on its own.
  expect(html).not.toContain('>Remove<')
  expect(html).toContain('Disconnect Telegram')
  expect(html).toContain('the owner and the allowed users are forgotten')
})

function preflight(health: TelegramHealth | null, more: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(PreflightCard, {
      configured: true,
      health,
      working: null,
      note: null,
      error: null,
      now: 1_000_000,
      onRun: nothing,
      onRestart: nothing,
      ...more,
    }),
  )
}

const passed: TelegramHealth = {
  configured: true,
  preflight: {
    botUsername: 'paperboat_bot',
    chatTitle: 'Paperboat agents',
    isForum: true,
    hasManageTopics: true,
    privacyModeOff: false,
    chatIsPrivate: true,
    memberCount: 3,
    ownerPresent: null,
  },
  error: null,
  polling: {
    running: true,
    activated: false,
    lastUpdateId: 48211907,
    lastSuccessfulPollAt: 996_000,
    startedAt: 1_000_000 - 3 * 3_600_000,
    error: 'not enough rights to manage topics',
  },
}

test('the preflight card offers its two actions only once credentials are saved', () => {
  const before = preflight(null, { configured: false })
  expect(before).toContain('Save the bot’s credentials above first.')
  expect(before).not.toContain('Run preflight')
  const ready = preflight(null)
  expect(ready).toContain('>Run preflight<')
  expect(ready).toContain('>Restart bot<')
  // No result yet: no state is claimed.
  expect(ready).not.toContain('All passed')
  expect(ready).not.toContain('<dl')
})

test('a preflight result lists every check, what is left to do, and how the bot is doing', () => {
  const html = preflight(passed)
  expect(html).toContain('1 to put right')
  expect(html.match(/<li /g)).toHaveLength(6)
  expect(html).toContain('<span class="sr-only">Failed: </span>')
  expect(html).toContain('Group members: 3.')
  const facts = Object.fromEntries(
    Array.from(html.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g), (match) => [
      match[1],
      (match[2] ?? '').replace(/<[^>]+>/g, ''),
    ]),
  )
  expect(facts).toEqual({
    Polling: 'Running',
    'Group setup': 'Awaiting activation',
    Started: '3 hours ago',
    'Last poll': 'just now',
    'Last update': '48211907',
    Error: 'not enough rights to manage topics',
  })
})

test('a preflight that Telegram refused names the step and what to do about it', () => {
  const html = preflight({
    configured: true,
    preflight: null,
    error: { step: 'getChat', message: 'Bad Request: chat not found' },
    polling: null,
  })
  expect(html).toContain('Failed')
  expect(html).toContain('role="alert"')
  expect(html).toContain('Failed at <code>getChat</code>')
  expect(html).toContain('Bad Request: chat not found')
  expect(html).toContain('add the bot to the group')
  // No bot runs: nothing is said about one.
  expect(html).not.toContain('The running bot')
})

test('asking for a restart, or failing to, is said in the card', () => {
  expect(preflight(null, { note: 'Restarting. Run the preflight in a few seconds.' })).toContain(
    'Restarting. Run the preflight in a few seconds.',
  )
  const failed = preflight(null, { error: 'the daemon is not running' })
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('the daemon is not running')
  const checking = preflight(null, { working: 'check' })
  expect(checking).toContain('Asking Telegram…')
  expect(checking).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Checking…<\/button>/)
})

test('the notifications card waits for its settings, then shows them with their state', () => {
  const loading = renderToStaticMarkup(
    createElement(NotificationsCard, { settings: undefined, error: null, onSaved: done }),
  )
  expect(loading).toContain('Loading…')
  expect(loading).not.toContain('type="submit"')

  const failed = renderToStaticMarkup(
    createElement(NotificationsCard, {
      settings: undefined,
      error: 'the daemon is not running',
      onSaved: done,
    }),
  )
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('the daemon is not running')

  const on = renderToStaticMarkup(
    createElement(NotificationsCard, {
      settings: {
        enabled: true,
        kinds: ['turn_failure'],
        timezone: 'Europe/Warsaw',
        quietHours: { start: '22:00', end: '07:00' },
        telegramReady: true,
      },
      error: null,
      onSaved: done,
    }),
  )
  expect(on).toMatch(/>On<\/span>/)
  expect(on.match(/type="checkbox"/g)).toHaveLength(4)
  expect(on.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(1)
  expect(on).toContain('type="time"')
  expect(on).toContain('value="Europe/Warsaw"')
  expect(on).not.toContain('The bot is not running yet')
  // Nothing was changed: nothing to save.
  expect(on).toMatch(/<button type="submit"[^>]*disabled=""/)

  const waiting = renderToStaticMarkup(
    createElement(NotificationsCard, {
      settings: {
        enabled: true,
        kinds: ['turn_failure'],
        timezone: 'UTC',
        quietHours: null,
        telegramReady: false,
      },
      error: null,
      onSaved: done,
    }),
  )
  expect(waiting).toContain('Waiting for the bot')
  expect(waiting).toContain('The bot is not running yet')
  expect(waiting).not.toContain('type="time"')
})
