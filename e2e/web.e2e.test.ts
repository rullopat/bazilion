// The web UI in a real browser, on the built package: every page renders without a page error,
// a console error or a failed request (in another language and time zone too, where the server's
// clock and the browser's differ), and the parts unit tests cannot reach work: the live feed, a
// question answered in the conversation, dropdowns, shortcuts, the phone layout and the
// notifications switch. Run with `pnpm build && pnpm test:e2e`.

import { expect as pw } from '@playwright/test'
import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { launchBrowser, type Session, signIn } from './browser.ts'
import {
  createLaunchSite,
  DEMO_MODEL,
  type DemoIds,
  demoScripts,
  seedDemoBase,
  seedDemoHistory,
} from './demo.ts'
import { type Instance, startInstance } from './instance.ts'
import { type ModelServer, startModelServer } from './model-server.ts'

let model: ModelServer
let instance: Instance
let browser: Browser
let ids: DemoIds
const sessions: Session[] = []

beforeAll(async () => {
  let known: Partial<DemoIds> = {}
  model = await startModelServer(
    demoScripts(() => known),
    { model: DEMO_MODEL },
  )
  instance = await startInstance({ modelUrl: model.url })
  browser = await launchBrowser()
  ids = await seedDemoBase(instance, await createLaunchSite())
  known = ids
  await seedDemoHistory(instance, ids)
})

afterEach(async () => {
  // No question or turn outlives its test.
  for (const id of Object.values(ids ?? {}))
    await instance.api(`/api/agents/${id}/cancel`, { method: 'POST' }).catch(() => {})
  await Promise.all(sessions.splice(0).map((session) => session.close()))
})

afterAll(async () => {
  await browser?.close()
  await instance?.stop()
  await model?.close()
})

async function open(options: Parameters<typeof signIn>[2] = {}): Promise<Session> {
  const session = await signIn(browser, instance, options)
  sessions.push(session)
  return session
}

function pages(): string[] {
  return [
    '/',
    `/?agent=${ids.mira}`,
    `/?agent=${ids.dev}&panel=changes`,
    `/?agent=${ids.mira}&panel=connections`,
    `/?agent=${ids.quill}&panel=files`,
    `/?agent=${ids.mira}&panel=agent&section=schedules`,
    `/?agent=${ids.dev}&view=changes`,
    `/?agent=${ids.mira}&view=connections`,
    '/?team=launch',
    '/attention',
    '/agents',
    '/teams',
    '/skills',
    '/templates/agents',
    '/templates/agents/default',
    '/templates/teams',
    '/config',
    '/config/tools',
    '/config/mcp',
    '/config/telegram',
    '/config/access',
    '/config/system',
  ]
}

test('every page renders without errors', async () => {
  const session = await open()
  for (const path of pages()) {
    await session.go(path)
    await pw(session.page.locator('main')).toBeVisible()
  }
  expect(session.problems).toEqual([])
})

test('every page renders without errors in another language and time zone', async () => {
  // Times written on the server in its zone and again in the browser in another: React #418.
  const session = await open({ locale: 'de-DE', timezoneId: 'Pacific/Auckland' })
  for (const path of pages()) await session.go(path)
  expect(session.problems).toEqual([])
})

test('a question asked elsewhere reaches the open page at once, without polling', async () => {
  const session = await open()
  await session.go('/', 1500)
  const polled: string[] = []
  session.page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/activity' || path === '/api/attention/summary') polled.push(path)
  })
  const waiting = session.page.getByRole('region', { name: 'Overview' }).getByRole('link', {
    name: /Quill.*Waiting for you/,
  })
  await pw(waiting).toHaveCount(0)

  void instance
    .chat(ids.quill, 'Before you finalise it: ask me which headline to use.', {
      questionMode: 'web',
    })
    .catch(() => {})
  await pw(waiting).toContainText('Waiting for you: a question', { timeout: 5_000 })
  await pw(session.page.getByRole('link', { name: /Attention.*1 open item/ })).toBeVisible()
  await pw(session.page).toHaveTitle(/^\(1\) /)
  await session.page.waitForTimeout(4_000)
  expect(polled).toEqual([])
  expect(session.problems).toEqual([])
})

test('a question is answered in the conversation and the turn goes on', async () => {
  const session = await open()
  await session.go(`/?agent=${ids.dev}`)
  const composer = session.page.getByPlaceholder('Message Dev')
  await composer.fill('The diff looks good. Which one should we deploy to?')
  await composer.press('Enter')
  const questions = session.page.getByRole('region', { name: 'Agent questions' })
  await pw(questions).toContainText('Where should the dark-mode build go first?', {
    timeout: 15_000,
  })
  await questions.getByRole('button', { name: /Staging/ }).click()
  await pw(session.page.getByText('Understood. I will go with that.')).toBeVisible({
    timeout: 15_000,
  })
  await pw(questions).toHaveCount(0)
  expect(session.problems).toEqual([])
})

test('dropdowns pick, and shortcuts open only outside fields and lists', async () => {
  const session = await open()
  await session.go('/attention')
  const page = session.page
  await page.getByRole('combobox', { name: 'Severity' }).click()
  // `?` inside an open list does not open the shortcuts.
  await page.keyboard.press('?')
  await pw(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Errors', exact: true }).click()
  await pw(page.getByRole('combobox', { name: 'Severity' })).toContainText('Errors')

  await page.keyboard.press('?')
  await pw(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await pw(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await pw(page.getByRole('combobox', { name: 'Jump to or do anything' })).toBeFocused()
  await page.keyboard.type('Dev')
  // Typed and entered at once, before the palette's lists have arrived.
  await page.keyboard.press('Enter')
  await pw(page).toHaveURL(new RegExp(`agent=${ids.dev}`))
  await pw(page.getByPlaceholder('Message Dev')).toBeVisible()
  expect(session.problems).toEqual([])
})

test('on a phone, the Agents waiting for you are above the list', async () => {
  const session = await open({ width: 390, height: 844 })
  await session.go('/')
  const strip = session.page.getByRole('region', { name: 'Waiting for you' })
  await pw(strip).toHaveCount(0)
  void instance
    .chat(ids.quill, 'Before you finalise it: ask me which headline to use.', {
      questionMode: 'web',
    })
    .catch(() => {})
  await pw(strip).toContainText('Quill', { timeout: 5_000 })
  await strip.getByRole('link', { name: /Quill/ }).click()
  await pw(session.page.getByRole('region', { name: 'Agent questions' })).toContainText(
    'Which headline should the announcement use?',
  )
  expect(session.problems).toEqual([])
})

test('desktop notifications are turned on and off from the session menu', async () => {
  const session = await open()
  await session.context.grantPermissions(['notifications'], { origin: instance.web })
  await session.go('/')
  const page = session.page
  const menu = page.getByRole('button', { name: 'Theme, notifications and log out' })
  await menu.click()
  await page.getByRole('menuitem', { name: /Notify me on this computer/ }).click()
  await pw(page.getByRole('menuitem', { name: /Turn off desktop notifications/ })).toBeVisible()
  await page.getByRole('menuitem', { name: /Turn off desktop notifications/ }).click()
  await menu.click()
  await pw(page.getByRole('menuitem', { name: /Notify me on this computer/ })).toBeVisible()
  expect(session.problems).toEqual([])
})

test('the live feed comes back after the daemon restarts', async () => {
  const session = await open()
  await session.go('/', 1500)
  await instance.restart()
  void instance
    .chat(ids.quill, 'Before you finalise it: ask me which headline to use.', {
      questionMode: 'web',
    })
    .catch(() => {})
  await pw(
    session.page
      .getByRole('region', { name: 'Overview' })
      .getByRole('link', { name: /Quill.*Waiting for you/ }),
  ).toBeVisible({ timeout: 20_000 })
  // Requests failed while the daemon was down, as they should; the page itself did not.
  expect(session.problems.filter((problem) => problem.startsWith('page error'))).toEqual([])
})
