// The product pictures of bazilion.com, taken from scratch instances with the Paperboat demo
// (e2e/demo.ts) and a stand-in model server: no real provider is asked anything, and every key is
// made up. Needs `pnpm build`, Chrome (or Chromium) and `cwebp`.
//
//   pnpm site-pictures <out-dir> [name...]
//
// <out-dir> is usually bazilion-web/public/screenshots. Pictures in TWICE get a 1440 px file and a
// 2880 px `-2x` file; the others one file at most 1440 px wide. Names limit the run to those.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Browser, Page } from 'playwright'
import {
  openDb,
  providerStateRepo,
  readAuthFile,
  replaceCuratedModels,
  resolvePaths,
} from '../apps/daemon/src/core/index.ts'
import { writeProviderCheck } from '../apps/daemon/src/core/provider-checks.ts'
import { saveLoginCredentials } from '../apps/daemon/src/runtime/auth/openai-codex.ts'
import { listCatalogEntries } from '../apps/daemon/src/runtime/providers/catalog.ts'
import { launchBrowser, type Session, type SessionOptions, signIn } from '../e2e/browser.ts'
import {
  createLaunchSite,
  DEMO_MODEL,
  type DemoIds,
  demoScripts,
  seedDemoBase,
  seedDemoHistory,
  seedDemoManage,
  seedDemoUsage,
} from '../e2e/demo.ts'
import { type Instance, startInstance } from '../e2e/instance.ts'
import { startModelServer } from '../e2e/model-server.ts'

const TWICE = new Set([
  'workspace',
  'workspace-dark',
  'handoffs',
  'question',
  'connections',
  'changes',
  'files',
])

const [outArg, ...only] = process.argv.slice(2)
if (!outArg) {
  console.error('usage: pnpm site-pictures <out-dir> [name...]')
  process.exit(2)
}
const out = resolve(outArg)
const shots = mkdtempSync(join(tmpdir(), 'site-pictures-'))
mkdirSync(out, { recursive: true })
const wanted = (name: string) => only.length === 0 || only.includes(name)

async function shoot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  if (!wanted(name)) return
  await page.mouse.move(2, 2)
  await page.waitForTimeout(250)
  await page.screenshot({
    path: join(shots, `${name}.png`),
    ...(clip ? { clip, fullPage: clip.y + clip.height > (page.viewportSize()?.height ?? 0) } : {}),
  })
  console.log('shot', name)
}

/** The PNG's width, from its header. */
function widthOf(file: string): number {
  return readFileSync(file).readUInt32BE(16)
}

function toWebp(name: string): void {
  const png = join(shots, `${name}.png`)
  const one = ['-quiet', '-q', '86']
  if (TWICE.has(name)) {
    execFileSync('cwebp', [...one, '-resize', '1440', '0', png, '-o', join(out, `${name}.webp`)])
    execFileSync('cwebp', ['-quiet', '-q', '84', png, '-o', join(out, `${name}-2x.webp`)])
  } else {
    const resize = widthOf(png) > 1440 ? ['-resize', '1440', '0'] : []
    execFileSync('cwebp', [...one, ...resize, png, '-o', join(out, `${name}.webp`)])
  }
}

async function cancel(instance: Instance, ids: string[]) {
  for (const id of ids)
    await instance.api(`/api/agents/${id}/cancel`, { method: 'POST' }).catch(() => {})
}

async function session(browser: Browser, instance: Instance, options: SessionOptions = {}) {
  return signIn(browser, instance, { scale: 2, ...options })
}

/** The workspace and Manage, on the Paperboat demo. */
async function demoPictures(browser: Browser): Promise<void> {
  let known: Partial<DemoIds> = {}
  const model = await startModelServer(
    demoScripts(() => known),
    { model: DEMO_MODEL },
  )
  const instance = await startInstance({ modelUrl: model.url })
  try {
    const ids = await seedDemoBase(instance, await createLaunchSite(browser))
    known = ids
    await seedDemoHistory(instance, ids)
    await seedDemoManage(instance)
    await seedDemoUsage(instance, ids)
    // The Research Team is unfolded, as an operator who uses it would have it.
    const cookies = [
      {
        name: 'bz_sidebar_open_groups',
        value: encodeURIComponent(JSON.stringify({ research: true })),
      },
    ]
    const main = await session(browser, instance, { cookies })
    // The first look at the list is what "new" is measured against.
    await main.go('/', 4500)
    // Then the Team gets busy: Pixel delivers two covers, Quill asks, Scout is at work.
    await instance.chat(
      ids.pixel,
      'I need a cover image for the announcement, 1200×630, warm colours.',
    )
    void instance
      .chat(ids.quill, 'Before you finalise it: ask me which headline to use.', {
        questionMode: 'web',
      })
      .catch(() => {})
    void instance.chat(ids.scout, 'Find out what our competitors charge for sync.').catch(() => {})
    await main.page.waitForTimeout(6000)
    await workspacePictures(main, ids)
    await main.close()

    const dark = await session(browser, instance, { dark: true, cookies })
    await dark.go(`/?agent=${ids.dev}&panel=changes&file=site/styles.css`, 4500)
    await shoot(dark.page, 'workspace-dark')
    await dark.close()

    const phone = await session(browser, instance, { width: 390, height: 844, cookies })
    await phone.go('/', 4500)
    // The strip and the top of the list.
    await shoot(phone.page, 'phone-waiting', { x: 0, y: 0, width: 390, height: 600 })
    await phone.go(`/?agent=${ids.dev}`, 1500)
    await shoot(phone.page, 'phone-chat')
    await phone.close()

    await cancel(instance, [ids.scout, ids.quill])
  } finally {
    await instance.stop()
    await model.close()
  }
}

async function workspacePictures(main: Session, ids: DemoIds): Promise<void> {
  const page = main.page
  await main.go('/', 2500)
  await shoot(page, 'overview')
  await main.go('/attention', 1500)
  await shoot(page, 'attention', { x: 0, y: 0, width: 1440, height: 640 })
  await main.go(`/?agent=${ids.mira}`, 1500)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(1500)
  await shoot(page, 'palette', { x: 432, y: 104, width: 576, height: 620 })
  // Words typed also find messages in the conversations.
  await page.keyboard.type('dark mode')
  await page.waitForTimeout(1500)
  await shoot(page, 'search', { x: 432, y: 104, width: 576, height: 620 })
  await page.keyboard.press('Escape')
  await main.go('/usage', 2000)
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await shoot(page, 'usage', { x: 0, y: 0, width: 1440, height: 1300 })
  await main.go(`/?agent=${ids.mira}&panel=agent&section=schedules`, 1500)
  const sheet = await page.getByRole('dialog').first().boundingBox()
  await shoot(
    page,
    'schedules',
    sheet
      ? { x: sheet.x - 16, y: sheet.y - 16, width: sheet.width + 32, height: sheet.height + 32 }
      : undefined,
  )

  await main.go(`/?agent=${ids.dev}&panel=changes&file=site/styles.css`, 1500)
  await shoot(page, 'workspace')
  await main.go(`/?agent=${ids.mira}&panel=connections`, 1500)
  await shoot(page, 'handoffs')
  await main.go(`/?agent=${ids.quill}&panel=files`, 1500)
  await shoot(page, 'question')

  await main.go(`/?agent=${ids.mira}&view=connections`, 2500)
  const pair = `pair:${[ids.mira, ids.dev].sort().join('|')}`
  await page
    .locator(`[data-testid="rf__edge-${pair}"] .react-flow__edge-textwrapper`)
    .click({ force: true })
  await page.waitForTimeout(500)
  await shoot(page, 'connections')

  await main.go(`/?agent=${ids.dev}&view=changes&file=site/styles.css`, 1800)
  for (const [line, text] of [
    [14, 'Keep the old colour as a fallback for browsers without custom properties.'],
    [31, 'The button needs a visible focus style in both themes.'],
  ] as const) {
    await page.getByRole('button', { name: `Comment on line ${line}`, exact: true }).click()
    await page.getByPlaceholder(/What should change on line/).fill(text)
    await page.getByRole('button', { name: 'Add to the review' }).click()
  }
  await page.waitForTimeout(400)
  await shoot(page, 'changes')

  await main.go(`/?agent=${ids.pixel}&view=files`, 1500)
  await page.getByRole('link', { name: 'Open cover-warm.png' }).click()
  await page.waitForTimeout(1200)
  await shoot(page, 'files')

  const settle = async () => {
    // Nothing keeps a focus ring: the picture shows the page as it rests.
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.mouse.move(2, 2)
    await page.waitForTimeout(500)
  }
  await main.go('/agents', 1200)
  await settle()
  await shoot(page, 'manage-agents', { x: 0, y: 0, width: 1440, height: 1140 })
  await main.go('/templates/agents/writer', 1200)
  await settle()
  await shoot(page, 'agent-template', { x: 0, y: 0, width: 1440, height: 1440 })
}

/**
 * What only a real account makes: a ChatGPT sign-in and two tests that passed. Written into the
 * home while its daemon is stopped; everything is invented.
 */
function seedSignIn(home: string): void {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  try {
    const { token } = readAuthFile(paths.authFile)
    const claims = Buffer.from(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'demo-account' } }),
    ).toString('base64url')
    saveLoginCredentials(db, token, {
      access: `demo.${claims}.demo`,
      refresh: 'demo-refresh',
      expires: Date.now() + 30 * 24 * 3_600_000,
    })
    providerStateRepo.setEnabled(db, 'openai-codex', true)
    replaceCuratedModels(db, 'openai-codex', ['gpt-6.2-sol', 'gpt-6-luna'])
    const nameOf = (provider: string, id: string) =>
      listCatalogEntries(provider).find((model) => model.id === id)?.name
    const minute = 60_000
    writeProviderCheck(db, 'openai-codex', {
      ok: true,
      at: Date.now() - 26 * 60 * minute,
      model: 'gpt-6-luna',
      modelName: nameOf('openai-codex', 'gpt-6-luna'),
      ms: 1_240,
    })
    writeProviderCheck(db, 'anthropic', {
      ok: true,
      at: Date.now() - 2 * 24 * 60 * minute,
      model: 'claude-haiku-5-5',
      modelName: nameOf('anthropic', 'claude-haiku-5-5'),
      ms: 870,
    })
  } finally {
    db.close()
  }
}

/** Setup: the first run, the connect form, Models, Tools and the model menu. */
async function setupPictures(browser: Browser): Promise<void> {
  const model = await startModelServer([], {
    model: 'qwen3-coder-30b',
    models: ['qwen3-coder-30b', 'gemma-3-12b', 'llama3.3-70b'],
  })
  const home = mkdtempSync(join(tmpdir(), 'site-pictures-setup-'))
  // LM Studio is found on its usual address only when the stand-in is there; any address works
  // for the pictures, which do not show it.
  let instance = await startInstance({ modelUrl: model.url, home })
  try {
    const first = await session(browser, instance)
    await first.go('/welcome', 1200)
    await shoot(first.page, 'first-run')
    // The connect form, with a made-up key typed. Nothing is sent: it is never submitted.
    await first.page.locator('main button', { hasText: 'Anthropic' }).first().click()
    await first.page.locator('main input[type=password]').first().waitFor()
    await first.page.waitForTimeout(1200)
    await first.page
      .locator('main input[type=password]')
      .first()
      .fill('sk-ant-api03-not-a-real-key-000000000000')
    await shoot(first.page, 'connect')
    await first.close()

    await instance.api('/api/config/providers/lmstudio/connect', {
      body: { models: ['qwen3-coder-30b', 'llama3.3-70b'] },
    })
    // A made-up key, saved without a request to the provider.
    await instance.api('/api/config/providers/anthropic/connect', {
      body: {
        fields: { ANTHROPIC_API_KEY: 'sk-ant-api03-not-a-real-key-000000000000' },
        models: ['claude-fable-5-2', 'claude-haiku-5-5'],
        test: false,
      },
    })
    await instance.api('/api/teams', { body: { id: 'launch', name: 'Launch' } })
    await instance.api('/api/teams', { body: { id: 'research', name: 'Research' } })
    const ids: Record<string, string> = {}
    for (const [key, name, teamId] of [
      ['mira', 'Mira', 'launch'],
      ['dev', 'Dev', 'launch'],
      ['pixel', 'Pixel', 'launch'],
      ['quill', 'Quill', 'launch'],
      ['baziu', 'Baziu', 'default'],
      ['scout', 'Scout', 'research'],
      ['sage', 'Sage', 'research'],
    ] as const) {
      const { agent } = await instance.api<{ agent: { id: string } }>('/api/agents', {
        body: { profileId: 'default', name, teamId },
      })
      ids[key] = agent.id
    }
    await instance.stop()
    seedSignIn(home)
    instance = await startInstance({ modelUrl: model.url, home })

    await instance.api('/api/config/fields/BAZILION_IMAGE_MODEL', {
      method: 'PUT',
      body: { value: 'openai-codex:gpt-image-2' },
    })
    await instance.api('/api/profiles/default', {
      method: 'PATCH',
      body: { defaultModel: 'anthropic:claude-fable-5-2' },
    })
    for (const [key, value] of [
      ['dev', 'openai-codex:gpt-6.2-sol'],
      ['pixel', 'openai-codex:gpt-6.2-sol'],
      ['scout', 'anthropic:claude-haiku-5-5'],
      ['sage', 'lmstudio:qwen3-coder-30b'],
    ] as const) {
      await instance.api(`/api/agents/${ids[key]}`, {
        method: 'PATCH',
        body: { modelOverride: value },
      })
    }
    // So the search card reads "Using Brave"; nothing goes to Brave unless an Agent searches.
    await instance.api('/api/config/fields', {
      method: 'PUT',
      body: {
        values: {
          BRAVE_API_KEY: 'BSA-not-a-real-key-000000',
          BAZILION_BASH_APPROVAL: 'dangerous',
        },
      },
    })

    const tall = async (path: string, name: string, height: number) => {
      const page = await session(browser, instance, { height })
      await page.go(path, 1200)
      await shoot(page.page, name)
      await page.close()
    }
    await tall('/config', 'models', 1620)
    await tall('/config/tools', 'tools', 1710)

    // The model menu, open in the spawn dialog, cut to the dialog and its menu.
    const menu = await session(browser, instance, { height: 1400 })
    await menu.go('/', 1200)
    const page = menu.page
    await page.getByRole('button', { name: 'Create a new Agent or Team' }).click()
    await page.getByRole('menuitem').first().click()
    const dialog = page.locator('[role=dialog]')
    await dialog.getByLabel(/Name/).fill('Nova')
    await dialog.getByRole('combobox', { name: /Model/ }).click()
    await page.getByRole('listbox').waitFor()
    await page.waitForTimeout(500)
    const boxes = [
      await dialog.boundingBox(),
      await page.getByRole('listbox').boundingBox(),
    ].filter((box) => box !== null)
    const pad = 56
    const left = Math.min(...boxes.map((box) => box.x)) - pad
    const top = Math.min(...boxes.map((box) => box.y)) - pad
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + pad
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad
    await shoot(page, 'model-menu', { x: left, y: top, width: right - left, height: bottom - top })
    await menu.close()
  } finally {
    await instance.stop()
    rmSync(home, { recursive: true, force: true })
    await model.close()
  }
}

const browser = await launchBrowser()
try {
  const demo = [
    'overview',
    'attention',
    'palette',
    'search',
    'usage',
    'schedules',
    'workspace',
    'handoffs',
    'question',
    'connections',
    'changes',
    'files',
    'manage-agents',
    'agent-template',
    'workspace-dark',
    'phone-waiting',
    'phone-chat',
  ]
  const setup = ['first-run', 'connect', 'models', 'tools', 'model-menu']
  if (demo.some(wanted)) await demoPictures(browser)
  if (setup.some(wanted)) await setupPictures(browser)
  for (const name of [...demo, ...setup].filter(wanted)) toWebp(name)
  console.log(`pictures written to ${out}`)
} finally {
  await browser.close()
  rmSync(shots, { recursive: true, force: true })
}
