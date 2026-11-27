// The web UI in a real browser, on the built package: every page renders without a page error,
// a console error or a failed request (in another language and time zone too, where the server's
// clock and the browser's differ), and the parts unit tests cannot reach work: the live feed, a
// question answered in the conversation, dropdowns, shortcuts, the phone layout and the
// notifications switch. Run with `pnpm build && pnpm test:e2e`.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect as pw } from '@playwright/test'
import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { accessibilityProblems } from './accessibility.ts'
import { closeBrowser, launchBrowser, type Session, signIn } from './browser.ts'
import {
  createLaunchSite,
  DEMO_MODEL,
  type DemoIds,
  demoScripts,
  seedCompaction,
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
  // The servers first: a browser that hangs on closing must not leave them running.
  await instance?.stop()
  await model?.close()
  await closeBrowser(browser)
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
    `/?agent=${ids.mira}&panel=agent&section=jobs`,
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

test('`bazilion open` signs a browser in without a token, once per link', async () => {
  const cli = join(import.meta.dirname, '..', 'apps', 'cli', 'dist', 'cli.js')
  const link = () => {
    const printed = spawnSync(
      process.execPath,
      [
        cli,
        'open',
        '--print',
        '--port',
        new URL(instance.web).port,
        '--daemon-port',
        new URL(instance.daemon).port,
      ],
      { env: { ...process.env, BAZILION_HOME: instance.home }, encoding: 'utf8' },
    )
    expect(printed.status, printed.stderr).toBe(0)
    return printed.stdout.trim()
  }
  const url = link()
  expect(url.startsWith(`${instance.web}/api/login/link?code=`)).toBe(true)
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(url)
    await page.waitForLoadState('load')
    expect(new URL(page.url()).pathname).toBe('/')
    await pw(page.locator('main')).toBeVisible()

    // The same link again, in a browser that is not signed in, leads to the login page, which
    // says what happened and how to sign in without a token.
    const other = await browser.newContext()
    try {
      const again = await other.newPage()
      await again.goto(url)
      expect(new URL(again.url()).pathname).toBe('/login')
      await pw(again.getByRole('alert')).toContainText('already used or has expired')
      await pw(again.getByText('it signs this browser in')).toBeVisible()
    } finally {
      await other.close()
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
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
  // Dev opens at its own end, not where Mira was; scrolled to its top, it is somewhere else again.
  const devLog = page.getByRole('log', { name: 'Conversation with Dev' })
  await page.waitForTimeout(200)
  expect(await devLog.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200)
  const devLeft = await devLog.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
  expect(devLeft).toBeLessThan(40)
  await devLog.evaluate((el) => {
    el.scrollTop = 0
  })
  await page.waitForTimeout(200)
  await rail.getByRole('link').filter({ hasText: 'Mira' }).first().click()
  await pw(page.getByPlaceholder('Message Mira')).toBeVisible()
  await page.waitForTimeout(200)
  const back = await log.evaluate((el) => el.scrollTop)
  expect(Math.abs(back - 120)).toBeLessThan(30)
  // A reload forgets the places, and nothing kept in the tab puts an offset back on a
  // conversation: each opens at its end.
  await page.reload()
  await pw(page.getByPlaceholder('Message Mira')).toBeVisible()
  await page.waitForTimeout(300)
  expect(await log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(
    40,
  )
  await rail.getByRole('link').filter({ hasText: 'Dev' }).first().click()
  await pw(page.getByPlaceholder('Message Dev')).toBeVisible()
  await page.waitForTimeout(300)
  expect(
    await devLog.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
  ).toBeLessThan(40)
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

test('an open Team says its members need no connections, and what saved ones are for', async () => {
  // Research is open; two connections between its members are saved anyway.
  await instance.api('/api/teams/research/policy', {
    method: 'PATCH',
    body: {
      edges: [
        { from: ids.scout, to: ids.sage },
        { from: ids.sage, to: ids.scout },
      ],
    },
  })
  try {
    const session = await open()
    await session.go(`/?agent=${ids.scout}&panel=connections`)
    const card = session.page.getByText('Everyone can message everyone').locator('..')
    await pw(card).toContainText('with no connections needed')
    await pw(card).toContainText('2 connections between teammates are saved; they apply then.')
    expect(session.problems).toEqual([])
  } finally {
    await instance.api('/api/teams/research/policy', { method: 'PATCH', body: { edges: [] } })
  }
})

test('an Agent added with its job starts on it, and a Team has each name once', async () => {
  const session = await open()
  await session.go('/?team=launch', 1500)
  const home = session.page.getByRole('region', { name: 'Launch' })
  const dialog = session.page.getByRole('dialog', { name: 'Add an Agent' })
  await home.getByRole('button', { name: 'Add an Agent' }).click()
  await dialog.getByLabel('Name').fill('Rhea')
  await dialog.getByLabel('What is it for?').fill('Writes the weekly newsletter.')
  await dialog.getByRole('button', { name: 'Add the Agent' }).click()
  await pw(dialog).toBeHidden()
  const agents = await instance.api<Array<{ id: string; name: string }>>('/api/agents')
  const rhea = agents.find((agent) => agent.name === 'Rhea')
  expect(rhea).toBeDefined()
  try {
    // Its job is on top of its instructions, and it skips the ritual that asks its name.
    const dir = join(instance.home, 'agents', rhea?.id ?? '')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toMatch(
      /^# Your role\n\nWrites the weekly newsletter\.\n\nThe operator added you to the Team Launch/,
    )
    expect(existsSync(join(dir, 'BOOTSTRAP.md'))).toBe(false)
    // Adding it opened its conversation, its first line ready to be typed.
    await pw(session.page.getByPlaceholder('Message Rhea')).toBeVisible()
    // Another "mira" in Launch is refused, whatever its case. Jump to adds to the open Agent's
    // Team, without leaving the page while it is still loading.
    await session.page.keyboard.press('Control+k')
    await session.page.keyboard.type('Add an Agent')
    await session.page
      .getByRole('option', { name: /Add an Agent/ })
      .first()
      .click()
    await pw(dialog.getByLabel('Team')).toContainText('Launch')
    await dialog.getByLabel('Name').fill('mira')
    await dialog.getByRole('button', { name: 'Add the Agent' }).click()
    await pw(dialog.getByRole('alert')).toContainText('Launch already has an Agent named mira.')
    expect(session.problems.filter((problem) => !problem.includes('409'))).toEqual([])
  } finally {
    if (rhea) await instance.api(`/api/agents/${rhea.id}`, { method: 'DELETE' })
  }
})

test('an Agent that calls itself something else shows both names and can take its own', async () => {
  const identity = join(instance.home, 'agents', ids.quill, 'IDENTITY.md')
  const before = readFileSync(identity, 'utf8')
  writeFileSync(identity, before.replace('- **Name:** Quill', '- **Name:** Quillon'))
  try {
    const session = await open()
    await session.go(`/?agent=${ids.quill}&panel=agent`, 1500)
    await pw(session.page.getByRole('heading', { level: 1 })).toContainText('Quillon')
    await session.page.getByRole('button', { name: 'Use Quillon as its name' }).click()
    const rail = session.page.getByRole('navigation', { name: 'Teams and agents' })
    await pw(rail.getByRole('link').filter({ hasText: 'Quillon' })).toBeVisible({ timeout: 5_000 })
    await pw(session.page.getByRole('button', { name: 'Use Quillon as its name' })).toBeHidden()
    expect(session.problems).toEqual([])
  } finally {
    writeFileSync(identity, before)
    await instance.api(`/api/agents/${ids.quill}`, { method: 'PATCH', body: { name: 'Quill' } })
  }
})

test('connecting two teammates of an open Team asks to switch it to Connections only', async () => {
  const session = await open()
  await session.go(`/?agent=${ids.scout}&view=connections`, 1500)
  const modes = session.page.getByRole('group', { name: 'Who can message whom' })
  await pw(modes.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true')
  await session.page
    .getByRole('group', { name: 'Show as' })
    .getByRole('button', { name: 'Table' })
    .click()
  await session.page.getByRole('button', { name: 'Allow Scout to Sage' }).click()
  const question = session.page.getByRole('dialog', {
    name: 'Switch the Team to Connections only?',
  })
  await pw(question).toBeVisible()
  await question.getByRole('button', { name: 'Switch and connect' }).click()
  await pw(modes.getByRole('button', { name: 'Connections only' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await pw(session.page.getByRole('button', { name: 'Deny Scout to Sage' })).toBeVisible()
  // Nothing is saved until Save.
  const policy = await instance.api<{ mode: string }>('/api/teams/research/policy')
  expect(policy.mode).toBe('open')
  expect(session.problems).toEqual([])
})

test("a Team's overview shows its day so far", async () => {
  const session = await open()
  await session.go('/?team=launch', 1500)
  const home = session.page.getByRole('region', { name: 'Launch' })
  await pw(home.getByRole('heading', { name: 'Today' })).toBeVisible()
  // Mira handed the launch work to her teammates in the demo history.
  await pw(home.getByRole('link').filter({ hasText: 'Mira handed off to' }).first()).toBeVisible()
  await pw(home.getByRole('link').filter({ hasText: 'delivered' }).first()).toBeVisible()
  expect(session.problems).toEqual([])
})

test('a common connection asks only for what it needs and keeps its secret', async () => {
  const session = await open()
  await session.go('/config/mcp')
  await session.page.getByRole('button', { name: 'Connect Notion' }).click()
  const dialog = session.page.getByRole('dialog', { name: 'Connect Notion' })
  const add = dialog.getByRole('button', { name: 'Add Notion' })
  await pw(add).toBeDisabled()
  // Checked once it has faded in: halfway, its colours are blended with the page behind it.
  await session.page.evaluate(
    // A cancelled animation rejects its `finished`: it is over all the same.
    `Promise.allSettled(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished))`,
  )
  expect(await accessibilityProblems(session.page, 'the Connect Notion dialog')).toEqual([])
  await dialog.getByLabel('Integration secret').fill('ntn_PRIVATE_E2E_VALUE')
  await add.click()
  await pw(dialog).toBeHidden()
  try {
    const servers = session.page.getByRole('region', { name: 'Servers' })
    await pw(servers).toContainText('variables: NOTION_TOKEN')
    await pw(servers).toContainText('asks you before tools that send or change something')
    await pw(
      session.page.getByRole('region', { name: 'Common connections' }).getByText('Added as notion'),
    ).toBeVisible()
    expect(await session.page.content()).not.toContain('ntn_PRIVATE_E2E_VALUE')
    expect(session.problems).toEqual([])
  } finally {
    // No later turn may start it: it would download the server.
    const { servers } = await instance.api<{ servers: Array<{ id: string }> }>('/api/mcp-servers')
    for (const server of servers)
      await instance.api(`/api/mcp-servers/${server.id}`, { method: 'DELETE' })
  }
})

test('a model whose server does not say its window gets one set by hand, and its row says so', async () => {
  const { providers } = await instance.api<{ providers: Array<{ id: string; models: string[] }> }>(
    '/api/config/providers',
  )
  const before = providers.find((provider) => provider.id === 'lmstudio')?.models ?? []
  // A model the stand-in has not loaded: LM Studio says no window for it.
  await instance.api('/api/config/providers/lmstudio/models', {
    method: 'PUT',
    body: { models: [...before, 'unloaded-model'] },
  })
  try {
    const session = await open()
    await session.go('/config')
    const chat = session.page.getByRole('region', { name: 'Chat' })
    await pw(chat).toContainText('Context window not known')
    await chat.getByRole('button', { name: 'Set the context window of unloaded-model' }).click()
    const dialog = session.page.getByRole('dialog', { name: 'Context window of unloaded-model' })
    await session.page.evaluate(
      `Promise.allSettled(document.getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished))`,
    )
    expect(await accessibilityProblems(session.page, 'the context window dialog')).toEqual([])
    const save = dialog.getByRole('button', { name: 'Save' })
    await dialog.getByLabel('Tokens').fill('a lot')
    await pw(save).toBeDisabled()
    await dialog.getByLabel('Tokens').fill('24,576')
    await save.click()
    await pw(dialog).toBeHidden()
    await pw(chat).toContainText('25K context, set by you')
    // The stand-in's own model keeps the window its server says.
    await pw(chat).toContainText('33K context, from the server')
    expect(session.problems).toEqual([])
  } finally {
    // Taking the model out of Chat forgets its window too.
    await instance.api('/api/config/providers/lmstudio/models', {
      method: 'PUT',
      body: { models: before },
    })
  }
})

test('Setup → System says first which release the installation runs', async () => {
  const { version } = JSON.parse(
    readFileSync(join(import.meta.dirname, '../apps/cli/package.json'), 'utf8'),
  ) as { version: string }
  const session = await open()
  await session.go('/config/system')
  const card = session.page.getByRole('region', { name: 'Version' })
  await pw(card).toContainText(`Bazilion${version}`)
  // It is the first card of the page.
  await pw(session.page.locator('main section').first()).toHaveAttribute(
    'aria-labelledby',
    'system-version',
  )
  expect(session.problems).toEqual([])
})

test('an exchange between Agents going on shows in Connections, with what it used, and stops', async () => {
  // The scheduler is off: the message waits to be read, and its exchange goes on.
  await instance.api(`/api/agents/${ids.quill}/messages`, {
    body: { from: ids.mira, payload: { text: 'Draft the launch FAQ, please.' } },
  })
  const session = await open()
  await session.go(`/?agent=${ids.mira}&panel=connections`)
  const now = session.page.getByRole('region', { name: 'Going on now' })
  await pw(now).toContainText('Mira and Quill')
  await pw(now).toContainText('1 message since')
  // Nothing has used anything yet: no tokens to count.
  await pw(now).not.toContainText('tokens')
  await pw(now).toContainText('A message is waiting to be read')
  expect(await accessibilityProblems(session.page, 'the exchanges going on')).toEqual([])
  await now.getByRole('button', { name: 'Stop the exchange of Mira and Quill' }).click()
  await pw(now).toBeHidden()
  // It was stopped by you: Attention has nothing to say about it.
  const { items } = await instance.api<{ items: Array<{ kind: string }> }>(
    '/api/attention?state=open&limit=100',
  )
  expect(items.filter((item) => item.kind === 'agent_loop_break')).toEqual([])
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

test('a compacted conversation keeps its earlier messages under a divider, the Agent can reread them, and a meter says how full it is', async () => {
  // The first two messages summarized, the rest kept.
  const firstText = (
    await seedCompaction(
      instance,
      ids.dev,
      'Dev and Mira agreed on the dark-mode release checklist.',
    )
  ).slice(0, 40)

  const session = await open()
  await session.go(`/?agent=${ids.dev}`)
  const page = session.page
  const log = page.getByRole('log', { name: 'Conversation with Dev' })
  const divider = log.getByText(/Older messages summarized to make room \(24K tokens\)/)
  await pw(divider).toBeVisible()
  // The summarized messages are still there to read.
  await pw(log).toContainText(firstText)
  await log.getByText('Show the summary').click()
  await pw(log).toContainText('Dev and Mira agreed on the dark-mode release checklist.')
  // The model has not replied since: only the window is known.
  await pw(page.getByText('33K window')).toBeVisible()

  const composer = page.getByPlaceholder('Message Dev')
  await composer.fill('Thanks, that is all for now.')
  await composer.press('Enter')
  await pw(log.getByText('Noted. Tell me what you would like me to do next.')).toBeVisible({
    timeout: 15_000,
  })
  // The turn's end keeps the divider, and the meter has the model's own count.
  await pw(divider).toBeVisible()
  await pw(page.getByRole('meter', { name: 'Conversation size' })).toHaveAttribute(
    'aria-valuetext',
    '1K / 33K tokens',
  )
  // The summary opened above is still open: the divider, its summary and the meter, checked.
  await pw(log.getByText('Hide the summary')).toBeVisible()
  expect(await accessibilityProblems(page, 'a compacted conversation')).toEqual([])

  // The Agent rereads what the summary replaced: the step says so, and its output is the
  // summarized messages themselves, by number.
  await composer.fill('What did I first ask you here?')
  await composer.press('Enter')
  await pw(log.getByText('From before the summary: your first ask was')).toBeVisible({
    timeout: 15_000,
  })
  await log.getByRole('button', { name: /Searched older messages for dark-mode/ }).click()
  await pw(log).toContainText(/summarized messages holds? every word of "dark-mode"/)
  await pw(log).toContainText('#1 · user')

  // Beside the side panel, the meter shows where the bar has room for it, and never pushes the
  // panel button out of the bar.
  for (const [width, meter] of [
    [1440, true],
    [1280, false],
  ] as const) {
    await page.setViewportSize({ width, height: 900 })
    await session.go(`/?agent=${ids.dev}&panel=team`)
    const bar = page.getByRole('heading', { name: 'Dev', level: 1 }).locator('xpath=..')
    const button = page.getByRole('link', { name: 'Hide the side panel' })
    const [barBox, buttonBox] = [await bar.boundingBox(), await button.boundingBox()]
    if (!barBox || !buttonBox) throw new Error(`no bar at ${width}`)
    expect(buttonBox.x + buttonBox.width, `width ${width}`).toBeLessThanOrEqual(
      barBox.x + barBox.width,
    )
    await pw(page.getByRole('meter', { name: 'Conversation size' })).toHaveCount(meter ? 1 : 0)
  }
  expect(session.problems).toEqual([])
})
