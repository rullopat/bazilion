// The web UI in a real browser, on the built package: every page renders without a page error,
// a console error or a failed request (in another language and time zone too, where the server's
// clock and the browser's differ), and the parts unit tests cannot reach work: the live feed, a
// question answered in the conversation, dropdowns, shortcuts, the phone layout and the
// notifications switch. Run with `pnpm build && pnpm test:e2e`.

import { expect as pw } from '@playwright/test'
import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { accessibilityProblems } from './accessibility.ts'
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

// The focused element, and whether something shows it: an outline, a ring (a box shadow) or a
// change of border or background against the same element without the focus. Run in the page.
const FOCUSED = `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  // A field may show the focus on the box around it (focus-within), so two levels up count too.
  const boxes = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean)
  const look = () =>
    boxes.map((box) => {
      const style = getComputedStyle(box)
      return [
        style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
        style.boxShadow,
        style.borderColor,
        style.backgroundColor,
      ].join('|')
    })
  const focused = look()
  el.blur()
  const unfocused = look()
  el.focus()
  const ownOutline = focused[0].startsWith('true')
  const marked = ownOutline || focused.some((value, index) => value !== unfocused[index])
  const path = []
  for (let node = el; node && node !== document.body; node = node.parentElement)
    path.unshift(node.tagName + ':' + Array.prototype.indexOf.call(node.parentElement?.children ?? [], node))
  const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60)
  return { key: path.join('/'), name: el.tagName.toLowerCase() + ' "' + name + '"', marked }
})()`

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
    '/usage',
    `/usage?days=7&agent=${ids.mira}`,
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

test('every page passes the automatic accessibility checks, light and dark', async () => {
  const problems: string[] = []
  for (const dark of [false, true]) {
    const session = await open({ dark })
    for (const path of pages()) {
      await session.go(path)
      problems.push(...(await accessibilityProblems(session.page, `${dark ? 'dark ' : ''}${path}`)))
    }
    expect(session.problems).toEqual([])
  }
  expect(problems).toEqual([])
})

test('the keyboard reaches the controls of the main pages, and each shows it has the focus', async () => {
  const session = await open()
  const unmarked: string[] = []
  for (const path of ['/', `/?agent=${ids.mira}`, '/usage', '/attention', '/agents', '/config']) {
    await session.go(path)
    await session.page.locator('body').click({ position: { x: 1, y: 1 } })
    const seen = new Set<string>()
    for (let step = 0; step < 80; step++) {
      await session.page.keyboard.press('Tab')
      const focused = (await session.page.evaluate(FOCUSED)) as {
        key: string
        name: string
        marked: boolean
      } | null
      if (!focused || seen.has(focused.key)) break
      seen.add(focused.key)
      if (!focused.marked) unmarked.push(`${path}: ${focused.name}`)
    }
    expect(seen.size, path).toBeGreaterThan(3)
  }
  expect(unmarked).toEqual([])
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

  // A closed dropdown keeps the focus after a pick; the shortcuts work from there.
  await page.getByRole('combobox', { name: 'Severity' }).focus()
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

test('Usage counts the model calls, per Agent and per day, and the chart is read by keyboard', async () => {
  const session = await open()
  await session.go('/usage')
  const page = session.page
  const totals = page.getByRole('region', { name: 'Spent' })
  await pw(totals).toContainText('$0.00')
  // The stand-in model is a local server: tokens, no money.
  await pw(totals.getByRole('definition').nth(2)).not.toHaveText('0')
  await page.getByRole('region', { name: 'By Agent' }).getByRole('link', { name: 'Dev' }).click()
  await pw(page).toHaveURL(new RegExp(`agent=${ids.dev}`))
  await pw(page.getByText('Only Dev')).toBeVisible()
  await page.getByRole('button', { name: '7 days' }).click()
  await pw(page).toHaveURL(/days=7(&|$)/)
  await pw(page.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
  const chart = page.getByRole('slider')
  await chart.focus()
  const today = await chart.getAttribute('aria-valuetext')
  await page.keyboard.press('ArrowLeft')
  await pw(chart).not.toHaveAttribute('aria-valuetext', today ?? '')
  await page.getByRole('button', { name: 'Show every Agent' }).click()
  await pw(page.getByText('Only Dev')).toHaveCount(0)
  expect(session.problems).toEqual([])
})

test('words typed in Jump to find a message and open its conversation on it', async () => {
  const session = await open()
  await session.go('/')
  const page = session.page
  await page.keyboard.press('Control+k')
  await page.keyboard.type('warmer headline')
  const found = page.getByRole('option', { name: /headline is plain/ })
  await pw(found).toBeVisible({ timeout: 5_000 })
  await found.click()
  await pw(page).toHaveURL(new RegExp(`agent=${ids.quill}`))
  await pw(page.locator('.found-message')).toContainText('I can make it warmer')
  // Found: the words leave the address.
  await pw(page).not.toHaveURL(/find=/)
  expect(session.problems).toEqual([])
})

test('a text file shows its first lines on its tile in Files', async () => {
  const session = await open()
  await session.go(`/?agent=${ids.quill}&view=files`)
  await pw(session.page.locator('figure pre').first()).toContainText('# Paperboat 2.0 is here')
  expect(session.problems).toEqual([])
})

test('going to another Agent and back keeps where you were in the conversation', async () => {
  const session = await open({ width: 1280, height: 560 })
  await session.go(`/?agent=${ids.mira}`)
  const page = session.page
  const log = page.getByRole('log', { name: 'Conversation with Mira' })
  const scrollable = await log.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(scrollable).toBeGreaterThan(200)
  await log.evaluate((el) => {
    el.scrollTop = 120
  })
  await page.waitForTimeout(200)
  const rail = page.getByRole('navigation', { name: 'Teams and agents' })
  await rail.getByRole('link').filter({ hasText: 'Dev' }).first().click()
  await pw(page.getByPlaceholder('Message Dev')).toBeVisible()
  await rail.getByRole('link').filter({ hasText: 'Mira' }).first().click()
  await pw(page.getByPlaceholder('Message Mira')).toBeVisible()
  const back = await log.evaluate((el) => el.scrollTop)
  expect(Math.abs(back - 120)).toBeLessThan(30)
  expect(session.problems).toEqual([])
})

test('a question asked and answered elsewhere comes and goes in the open conversation', async () => {
  const session = await open()
  await session.go(`/?agent=${ids.quill}`, 1500)
  const questions = session.page.getByRole('region', { name: 'Agent questions' })
  // As a turn started from the terminal does.
  void instance
    .chat(ids.quill, 'Before you finalise it: ask me which headline to use.', {
      questionMode: 'web',
    })
    .catch(() => {})
  await pw(questions).toContainText('Which headline should the announcement use?', {
    timeout: 5_000,
  })
  const waiting = await instance.api<{ questions: Array<{ id: string }> }>(
    `/api/agents/${ids.quill}/questions`,
  )
  const asked = waiting.questions[0]?.id ?? ''
  // Answered elsewhere (the terminal, Telegram): the card goes.
  await instance.api(`/api/agents/${ids.quill}/questions/${asked}/answer`, {
    body: { answer: { kind: 'choice', index: 0 } },
  })
  await pw(questions).toHaveCount(0, { timeout: 5_000 })
  expect(session.problems).toEqual([])
})

test('a Team and an Agent made outside the page show up without a reload', async () => {
  const session = await open()
  // Dev's Team, Mira's too, is open in the list.
  await session.go(`/?agent=${ids.dev}`, 1500)
  const rail = session.page.getByRole('navigation', { name: 'Teams and agents' })
  // As `bazilion team add` does, or an Agent running it.
  await instance.api('/api/teams', { method: 'POST', body: { id: 'outreach', name: 'Outreach' } })
  await pw(rail).toContainText('Outreach', { timeout: 5_000 })
  // An Agent asked for a teammate adds it with agent_create.
  await instance.chat(ids.mira, 'Please add a fact-checker to the Team.')
  await pw(rail.getByRole('link').filter({ hasText: 'Fact Checker' })).toBeVisible({
    timeout: 5_000,
  })
  const agents = await instance.api<Array<{ name: string; teamId: string }>>('/api/agents')
  expect(agents.find((agent) => agent.name === 'Fact Checker')?.teamId).toBe(
    agents.find((agent) => agent.name === 'Mira')?.teamId,
  )
  expect(session.problems).toEqual([])
})

test('a page opened before an upgrade reloads for the new build instead of failing', async () => {
  const session = await open()
  await session.go(`/?agent=${ids.mira}&panel=connections`)
  // As after an upgrade: the old build's map is gone from the server, once.
  let refused = 0
  await session.page.route(/\/assets\/ConnectionsView-[^/]+\.js$/, async (route) => {
    if (refused++ === 0) await route.fulfill({ status: 404, body: '' })
    else await route.continue()
  })
  await session.page.getByRole('link', { name: 'Open the map' }).click()
  await pw(session.page.getByRole('region', { name: /^Connections of/ })).toBeVisible({
    timeout: 15_000,
  })
  // After the reload the page asks for the map's file again, and gets it.
  await expect.poll(() => refused, { timeout: 10_000 }).toBe(2)
  // The refused file is the only problem, and the page recovered from it.
  const refusal = /ConnectionsView|dynamically imported|status of 404/
  expect(session.problems.filter((problem) => !refusal.test(problem))).toEqual([])
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
