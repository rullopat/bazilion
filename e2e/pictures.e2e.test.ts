// Pictures of the web UI compared with the reference pictures in e2e/pictures/, pixel by pixel: a
// layout that breaks (text one letter per line, a card pushed off its column) fails here even when
// every other test passes. Times, dates and machine paths are written the same way each run first.
//
// Fonts render differently on each system, so the comparison runs on Linux CI only, where the
// references were taken (BAZILION_PICTURES=compare forces it, =update writes new references on a
// Linux machine, =off skips it). A failed run keeps what it saw in e2e/pictures-out/ (CI uploads
// it as the `pictures` artifact); `pnpm pictures:accept` copies those into e2e/pictures/ when the
// change is meant.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import type { Browser } from 'playwright'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  closeBrowser,
  launchBrowser,
  type Session,
  type SessionOptions,
  signIn,
} from './browser.ts'
import {
  createLaunchSite,
  DEMO_MODEL,
  type DemoIds,
  demoScripts,
  seedDemoBase,
  seedDemoHistory,
  seedDemoManage,
} from './demo.ts'
import { type Instance, startInstance } from './instance.ts'
import { type ModelServer, startModelServer } from './model-server.ts'

const MODE =
  process.env.BAZILION_PICTURES ??
  (process.platform === 'linux' && process.env.CI ? 'compare' : 'off')
const REFERENCES = join(import.meta.dirname, 'pictures')
const OUT = join(import.meta.dirname, 'pictures-out')
/** A pixel differs when its colour moves this much (pixelmatch's 0–1 scale)… */
const PIXEL_THRESHOLD = 0.1
/** …and a picture differs when more than this share of its pixels do. */
const PICTURE_THRESHOLD = 0.0005

// Run in the page: what changes from run to run is written the same way, so that the layout, not
// the clock, decides the picture. Text keeps its length class (a time stays a time).
const STEADY = String.raw`(() => {
  const rules = [
    [/(?:\/private)?\/(?:var\/folders|tmp)\/[^\s"'<>]*/g, '/demo/home'],
    [/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g, '2026-01-01'],
    [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '1/1/2026'],
    [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '12:00'],
    [/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,? \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\b/g, 'Mon 1 Jan'],
    [/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\b/g, '1 Jan'],
    [/\b\d+ (?:seconds?|secs?|minutes?|mins?|hours?|h|m|s) ago\b|\bjust now\b/g, '1 min ago'],
    // A scratch folder's random end: paperboat-skills-8bX7Cs.
    [/\b(paperboat-[a-z]+)-[A-Za-z0-9]{6}\b/g, '$1'],
    [/\bin \d+ (?:min|minutes?|hours?|h)\b/g, 'in 1 min'],
  ]
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let text = node.nodeValue
    for (const [pattern, steady] of rules) text = text.replace(pattern, steady)
    if (text !== node.nodeValue) node.nodeValue = text
  }
  for (const element of document.querySelectorAll('[title]')) {
    let title = element.getAttribute('title')
    for (const [pattern, steady] of rules) title = title.replace(pattern, steady)
    element.setAttribute('title', title)
  }
})()`

let model: ModelServer
let instance: Instance
let browser: Browser
let ids: DemoIds

interface Scene {
  name: string
  path: () => string
  options?: SessionOptions
}

const SCENES: Scene[] = [
  { name: 'overview', path: () => '/' },
  { name: 'conversation', path: () => `/?agent=${ids.mira}&panel=none` },
  {
    name: 'conversation-dark',
    path: () => `/?agent=${ids.mira}&panel=none`,
    options: { dark: true },
  },
  { name: 'handoffs', path: () => `/?agent=${ids.dev}&panel=connections` },
  { name: 'files', path: () => `/?agent=${ids.quill}&view=files` },
  { name: 'usage', path: () => '/usage' },
  { name: 'attention', path: () => '/attention' },
  { name: 'agents', path: () => '/agents' },
  { name: 'skills', path: () => '/skills' },
  { name: 'models', path: () => '/config' },
  { name: 'phone', path: () => '/', options: { width: 390, height: 844 } },
]

describe.skipIf(MODE === 'off')('pictures', () => {
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
    await seedDemoManage(instance)
    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(REFERENCES, { recursive: true })
  })

  afterAll(async () => {
    // The servers first: a browser that hangs on closing must not leave them running.
    await instance?.stop()
    await model?.close()
    await closeBrowser(browser)
  })

  /** The picture, decoded, and Chrome's own PNG bytes (far smaller than a re-encoding). */
  async function picture(scene: Scene): Promise<{ png: PNG; bytes: Buffer }> {
    // One language and time zone whatever the machine: dates and times read the same way.
    const session: Session = await signIn(browser, instance, {
      width: 1280,
      height: 800,
      locale: 'en-GB',
      timezoneId: 'UTC',
      ...scene.options,
    })
    try {
      await session.go(scene.path(), 1200)
      await session.page.evaluate('document.fonts.ready')
      await session.page.evaluate(STEADY)
      const bytes = await session.page.screenshot({ animations: 'disabled', caret: 'hide' })
      expect(session.problems).toEqual([])
      return { png: PNG.sync.read(bytes), bytes }
    } finally {
      await session.close()
    }
  }

  test('each scene looks as its reference picture does', async () => {
    const changed: string[] = []
    for (const scene of SCENES) {
      const { png: actual, bytes } = await picture(scene)
      const reference = join(REFERENCES, `${scene.name}.png`)
      if (MODE === 'update') {
        writeFileSync(reference, bytes)
        continue
      }
      const keep = (why: string, diff?: PNG) => {
        mkdirSync(OUT, { recursive: true })
        writeFileSync(join(OUT, `${scene.name}.png`), bytes)
        if (diff) writeFileSync(join(OUT, `${scene.name}.diff.png`), PNG.sync.write(diff))
        if (existsSync(reference)) copyFileSync(reference, join(OUT, `${scene.name}.reference.png`))
        changed.push(`${scene.name}: ${why}`)
      }
      if (!existsSync(reference)) {
        keep('no reference picture yet')
        continue
      }
      const expected = PNG.sync.read(readFileSync(reference))
      if (expected.width !== actual.width || expected.height !== actual.height) {
        keep(
          `size ${actual.width}×${actual.height}, the reference is ${expected.width}×${expected.height}`,
        )
        continue
      }
      const diff = new PNG({ width: actual.width, height: actual.height })
      const pixels = pixelmatch(
        expected.data,
        actual.data,
        diff.data,
        actual.width,
        actual.height,
        { threshold: PIXEL_THRESHOLD, includeAA: false },
      )
      if (pixels > actual.width * actual.height * PICTURE_THRESHOLD)
        keep(`${pixels} pixels differ`, diff)
    }
    expect(changed).toEqual([])
  })
})
