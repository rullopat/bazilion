import type { ServiceCard, ServiceFieldState } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  applies,
  changedValues,
  initialDraft,
  isDirty,
  numberProblems,
  shownNumber,
  storedNumber,
} from '../src/lib/tool-form.ts'

const yesNo = { type: 'switch', on: 'true', off: 'false', default: true } as const
function field(envVar: string, more: Partial<ServiceFieldState> = {}): ServiceFieldState {
  return { envVar, kind: 'config', label: envVar, input: { type: 'text' }, set: false, ...more }
}
const enabled = { envVar: 'BROWSER_ENABLED', is: ['true'] }
const browser: ServiceCard = {
  id: 'browser',
  displayName: 'Browser',
  fields: [
    field('BROWSER_ENABLED', { input: yesNo, effective: 'true' }),
    field('BROWSER_ATTACH', {
      input: {
        type: 'choice',
        default: 'false',
        options: [
          { value: 'false', label: 'Its own' },
          { value: 'true', label: 'Mine' },
        ],
      },
      effective: 'false',
      when: [enabled],
    }),
    field('BROWSER_IDLE_MS', {
      input: {
        type: 'number',
        default: 900_000,
        min: 60_000,
        max: 86_400_000,
        unit: 'minutes',
        scale: 60_000,
      },
      effective: '900000',
      when: [enabled],
    }),
    field('BROWSER_EXECUTABLE_PATH', {
      set: true,
      value: '/usr/bin/chromium',
      when: [enabled, { envVar: 'BROWSER_ATTACH', is: ['false'] }],
    }),
    field('BROWSER_ATTACH_URL', { when: [enabled, { envVar: 'BROWSER_ATTACH', is: ['true'] }] }),
  ],
}
const search: ServiceCard = {
  id: 'web-search',
  displayName: 'Web search',
  fields: [
    field('BRAVE_API_KEY', { kind: 'secret', set: true, preview: 'BSA123…' }),
    field('SEARXNG_URL', { set: true, value: 'https://old.example.com' }),
  ],
}
const typed = (card: ServiceCard, values: Record<string, string>, removed: string[] = []) => {
  const draft = initialDraft(card)
  return { values: { ...draft.values, ...values }, removed }
}

test('a card opens on what is in effect, numbers in the unit people read', () => {
  expect(initialDraft(browser)).toEqual({
    values: {
      BROWSER_ENABLED: 'true',
      BROWSER_ATTACH: 'false',
      BROWSER_IDLE_MS: '15',
      BROWSER_EXECUTABLE_PATH: '/usr/bin/chromium',
      BROWSER_ATTACH_URL: '',
    },
    removed: [],
  })
  expect(isDirty(browser, initialDraft(browser))).toBe(false)
  // A key is never put into the form: the field is empty until a new one is typed.
  expect(initialDraft(search).values.BRAVE_API_KEY).toBe('')
})

test('only what changed is sent, as it is stored', () => {
  expect(changedValues(browser, typed(browser, { BROWSER_IDLE_MS: '5' }))).toEqual({
    BROWSER_IDLE_MS: '300000',
  })
  expect(
    changedValues(
      browser,
      typed(browser, { BROWSER_ATTACH: 'true', BROWSER_ATTACH_URL: ' http://127.0.0.1:9222 ' }),
    ),
  ).toEqual({ BROWSER_ATTACH: 'true', BROWSER_ATTACH_URL: 'http://127.0.0.1:9222' })
  // Clearing a text field removes the setting.
  expect(changedValues(browser, typed(browser, { BROWSER_EXECUTABLE_PATH: '' }))).toEqual({
    BROWSER_EXECUTABLE_PATH: '',
  })
})

test('a setting that does not matter with the choices made is neither shown nor sent', () => {
  const off = typed(browser, { BROWSER_ENABLED: 'false', BROWSER_IDLE_MS: '5' })
  expect(
    browser.fields.filter((entry) => applies(entry, off)).map((entry) => entry.envVar),
  ).toEqual(['BROWSER_ENABLED'])
  expect(changedValues(browser, off)).toEqual({ BROWSER_ENABLED: 'false' })
  const mine = typed(browser, { BROWSER_ATTACH: 'true' })
  expect(
    browser.fields.filter((entry) => applies(entry, mine)).map((entry) => entry.envVar),
  ).toEqual(['BROWSER_ENABLED', 'BROWSER_ATTACH', 'BROWSER_IDLE_MS', 'BROWSER_ATTACH_URL'])
})

test('a key is replaced by typing one, removed only when asked, and kept otherwise', () => {
  expect(changedValues(search, initialDraft(search))).toEqual({})
  expect(changedValues(search, typed(search, { BRAVE_API_KEY: ' BSA-new ' }))).toEqual({
    BRAVE_API_KEY: 'BSA-new',
  })
  expect(changedValues(search, typed(search, {}, ['BRAVE_API_KEY']))).toEqual({ BRAVE_API_KEY: '' })
})

test('a number that cannot be saved says what it takes, in the unit shown', () => {
  expect(numberProblems(browser, initialDraft(browser))).toEqual({})
  expect(numberProblems(browser, typed(browser, { BROWSER_IDLE_MS: 'soon' }))).toEqual({
    BROWSER_IDLE_MS: 'A whole number from 1 to 1440.',
  })
  expect(numberProblems(browser, typed(browser, { BROWSER_IDLE_MS: '0' }))).toEqual({
    BROWSER_IDLE_MS: 'It has to be from 1 to 1440.',
  })
  // Not asked about while the browser is off.
  expect(
    numberProblems(browser, typed(browser, { BROWSER_ENABLED: 'false', BROWSER_IDLE_MS: '0' })),
  ).toEqual({})
})

test('a stored value the daemon cannot use is replaced by what the card shows', () => {
  const card: ServiceCard = {
    id: 'commands',
    displayName: 'Commands',
    fields: [
      field('BAZILION_BASH_APPROVAL', {
        input: { type: 'switch', on: 'dangerous', off: 'off', default: false },
        set: true,
        value: 'Dangerous',
        effective: 'off',
        unusable: true,
      }),
      field('BROWSER_MAX_SESSIONS', {
        input: { type: 'number', default: 4, min: 1, max: 64 },
        set: true,
        value: 'abc',
        effective: '4',
        unusable: true,
      }),
    ],
  }
  // Untouched, the card is still worth saving: it writes what it shows.
  expect(isDirty(card, initialDraft(card))).toBe(true)
  expect(changedValues(card, initialDraft(card))).toEqual({
    BAZILION_BASH_APPROVAL: 'off',
    BROWSER_MAX_SESSIONS: '4',
  })
  expect(numberProblems(card, initialDraft(card))).toEqual({})
})

test('minutes and milliseconds', () => {
  const idle = browser.fields[2] as ServiceFieldState
  expect(shownNumber(idle, '900000')).toBe('15')
  // Stored before it was checked: half a minute is shown as it is.
  expect(shownNumber(idle, '30000')).toBe('0.5')
  expect(storedNumber(idle, '15')).toBe('900000')
  expect(storedNumber(idle, '1.5')).toBeNull()
})

test('what the daemon’s environment sets is shown and left alone', () => {
  const card: ServiceCard = {
    id: 'web-search',
    displayName: 'Web search',
    fields: [
      field('SEARXNG_URL', {
        set: true,
        value: 'https://stored.example.com',
        effective: 'https://from-env.example.com',
        environment: true,
      }),
    ],
  }
  expect(initialDraft(card).values.SEARXNG_URL).toBe('https://from-env.example.com')
  expect(changedValues(card, typed(card, { SEARXNG_URL: 'https://typed.example.com' }))).toEqual({})
})
