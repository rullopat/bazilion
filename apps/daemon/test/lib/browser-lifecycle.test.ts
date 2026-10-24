// T07 — pool lifecycle: D4 transitions, per-agent serialization, busy-aware
// capacity, reaping versus in-flight work, config-change retirement and
// cancellation. All driven through an injectable launcher, so no browser is
// needed; the real launcher is covered by the gated lane and its own tests.
//
// The fake launcher exposes three gates so tests can hold work in flight:
//  - the launch gate (cancellation during startup),
//  - the page-navigation gate (an in-flight/busy action),
//  - the close gate (a slow retirement: the stopping-capacity window).
// All gates auto-release unless a test opts into holding them.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { afterEach, expect, test } from 'vitest'
import { resolvePaths } from '../../src/core/paths.ts'
import { createBrowserHost } from '../../src/lib/browser/host.ts'
import type { ManagedBrowserHandle, ManagedLaunchInput } from '../../src/lib/browser/launch.ts'
import {
  type BrowserAdmission,
  type BrowserConfig,
  closeBrowserSession,
  invokeBrowserAction,
  type PoolDeps,
  PoolError,
  reapIdleBrowserSessions,
} from '../../src/lib/browser/pool.ts'
import { resources } from '../../src/lib/resources.ts'

const homes: string[] = []
afterEach(async () => {
  for (const [, entry] of resources().browsers) await entry.close().catch(() => {})
  // recovery_required entries refuse retirement by design; tests start clean.
  resources().browsers.clear()
  while (homes.length) rmSync(homes.pop() as string, { recursive: true, force: true })
})

function makeAdmission(name = 'home'): BrowserAdmission {
  const home = mkdtempSync(join(tmpdir(), `baz069-lc-${name}-`))
  homes.push(home)
  return { paths: resolvePaths(join(home, 'bazilion')), agentId: 'agent-1', teamId: 'team-1' }
}

function config(overrides: Partial<BrowserConfig> = {}): BrowserConfig {
  return { mode: 'headless', allowPrivate: true, idleMs: 60_000, maxSessions: 4, ...overrides }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface FakeLaunchRecord {
  input: ManagedLaunchInput
  closeCalls: number
  navigationCalls: number
  activationCalls: number
  releaseActivation: () => void
  fillCalls: number
  submitCalls: number
  clickCalls: number
  keypressCalls: number
  generation: number
  documentId: string
  statsAvailable: boolean
  releaseFill: () => void
  releaseClick: () => void
  /** Releases a held launch. */
  releaseLaunch: () => void
  /** Releases a held in-flight navigation (the busy window). */
  releaseNavigation: () => void
  /** Releases a held retirement (the stopping window). */
  releaseClose: () => void
}

function makeLauncher(
  opts: {
    failClose?: boolean
    failPostActionCapture?: boolean
    clickError?: string
    holdLaunches?: boolean
    holdNavigation?: boolean
    holdActivation?: boolean
    failActivation?: boolean
    holdFill?: boolean
    holdClick?: boolean
    failPressAfterEffect?: boolean
    holdClose?: boolean
  } = {},
) {
  const launches: FakeLaunchRecord[] = []
  const launcher = async (input: ManagedLaunchInput): Promise<ManagedBrowserHandle> => {
    let releaseLaunch: () => void = () => {}
    const launchGate = new Promise<void>((r) => {
      releaseLaunch = r
    })
    if (!opts.holdLaunches) releaseLaunch()
    let releaseNavigation: () => void = () => {}
    const navigationGate = new Promise<void>((r) => {
      releaseNavigation = r
    })
    if (!opts.holdNavigation) releaseNavigation()
    let releaseActivation: () => void = () => {}
    const activationGate = new Promise<void>((resolve) => {
      releaseActivation = resolve
    })
    if (!opts.holdActivation) releaseActivation()
    let releaseFill: () => void = () => {}
    const fillGate = new Promise<void>((resolve) => {
      releaseFill = resolve
    })
    if (!opts.holdFill) releaseFill()
    let releaseClick: () => void = () => {}
    const clickGate = new Promise<void>((resolve) => {
      releaseClick = resolve
    })
    if (!opts.holdClick) releaseClick()
    let releaseClose: () => void = () => {}
    const closeGate = new Promise<void>((r) => {
      releaseClose = r
    })
    if (!opts.holdClose) releaseClose()

    const record: FakeLaunchRecord = {
      input,
      closeCalls: 0,
      navigationCalls: 0,
      activationCalls: 0,
      releaseActivation,
      fillCalls: 0,
      submitCalls: 0,
      clickCalls: 0,
      keypressCalls: 0,
      generation: 0,
      documentId: 'fixture-document',
      statsAvailable: true,
      releaseFill,
      releaseClick,
      releaseLaunch,
      releaseNavigation,
      releaseClose,
    }
    launches.push(record)
    await launchGate
    let url = 'about:blank'
    const page = {
      url: () => url,
      isClosed: () => false,
      goto: async (next: string) => {
        url = next
        record.navigationCalls++
        await navigationGate
      },
      bringToFront: async () => {
        record.activationCalls++
        if (opts.failActivation) throw new Error('native tab activation refused')
        await activationGate
      },
      title: async () => 'fake page',
      evaluate: async () =>
        record.statsAvailable
          ? { docId: record.documentId, generation: record.generation, nodes: 1, textChars: 100 }
          : null,
      getByRole: () => page.locator('fixture-role'),
      keyboard: {
        press: async () => {
          record.keypressCalls++
          if (opts.failPressAfterEffect) throw new Error('keypress failed after effect')
        },
      },
      locator: () => ({
        waitFor: async () => {},
        count: async () => 1,
        evaluate: async () =>
          record.statsAvailable
            ? { docId: record.documentId, generation: record.generation, nodes: 1, textChars: 100 }
            : null,
        ariaSnapshot: async () => {
          if (opts.failPostActionCapture && record.clickCalls > 0)
            throw new Error('body unavailable')
          return '- button "fixture" [ref=e1]'
        },
        click: async () => {
          record.clickCalls++
          await clickGate
          if (opts.clickError) throw new Error(opts.clickError)
        },
        fill: async () => {
          record.fillCalls++
          await fillGate
        },
        press: async () => {
          record.submitCalls++
        },
      }),
    } as unknown as Page
    const context = {
      pages: () => [page],
      on: () => {},
      close: async () => {
        record.closeCalls++
        await closeGate
      },
    } as unknown as BrowserContext
    return {
      context,
      launchNonce: `nonce-${launches.length}`,
      slotDir: `/tmp/fake-slot-${input.agentId}`,
      profileDir: `/tmp/fake-slot-${input.agentId}/user-data`,
      async close() {
        record.closeCalls++
        if (opts.failClose) {
          throw new Error('the owned browser did not exit within the retirement bound')
        }
        await closeGate
      },
    }
  }
  return { launcher, launches }
}

function runner(deps: PoolDeps, admission: BrowserAdmission) {
  return (agentId: string, cfg: BrowserConfig, action = 'snapshot') =>
    invokeBrowserAction(agentId, action, { url: 'http://fixture.test/' }, cfg, admission, deps)
}

test('tab selection awaits native activation before publishing a new observation', async () => {
  const admission = makeAdmission('native-activation')
  const fake = makeLauncher({ holdActivation: true })
  const run = (method: string, args: Record<string, unknown> = {}) =>
    invokeBrowserAction('activation-agent', method, args, config(), admission, {
      launch: fake.launcher,
    })
  await run('snapshot')
  const record = fake.launches[0]
  if (!record) throw new Error('fixture launch missing')
  let published = false
  const selecting = run('tabs', { op: 'select', tabId: 'tab-1' }).then((value) => {
    published = true
    return value
  })
  try {
    await sleep(5)
    expect(record.activationCalls).toBe(1)
    expect(published).toBe(false)
  } finally {
    record.releaseActivation()
  }
  const result = await selecting
  expect(result[0]).toMatchObject({ type: 'text', text: expect.stringContaining('tab tab-1') })
})

test('failed native tab activation revokes previous refs without dispatching an action', async () => {
  const admission = makeAdmission('failed-native-activation')
  const fake = makeLauncher({ failActivation: true })
  const run = (method: string, args: Record<string, unknown> = {}) =>
    invokeBrowserAction('activation-agent', method, args, config(), admission, {
      launch: fake.launcher,
    })
  const initial = await run('snapshot')
  const initialText = initial[0]?.type === 'text' ? initial[0].text : ''
  const observationId = /Observation: ([^ ]+)/.exec(initialText)?.[1]
  await expect(run('tabs', { op: 'select', tabId: 'tab-1' })).rejects.toThrow(
    /native tab activation refused/,
  )
  const stale = await run('click', { observationId, ref: 'e1' })
  expect(stale[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('No action was dispatched'),
  })
  expect(fake.launches[0]?.clickCalls).toBe(0)
})

test.each([
  'snapshot',
  'navigate',
  'click',
] as const)('a tab closed outside tools reconciles the canonical fallback before %s', async (action) => {
  const admission = makeAdmission('external-tab-close')
  const fake = makeLauncher()
  let closed = false
  const deps: PoolDeps = {
    launch: async (input) => {
      const handle = await fake.launcher(input)
      const first = handle.context.pages()[0]
      if (!first) throw new Error('missing fake first page')
      await first.goto('http://fixture.test/first')
      const second = {
        ...first,
        url: () => 'http://fixture.test/second',
        isClosed: () => closed,
      } as unknown as Page
      return {
        ...handle,
        context: { ...handle.context, pages: () => [first, second] } as BrowserContext,
      }
    },
  }
  const run = (method: string, args: Record<string, unknown> = {}) =>
    invokeBrowserAction('fallback-agent', method, args, config(), admission, deps)
  await run('snapshot')
  const selected = await run('tabs', { op: 'select', tabId: 'tab-2' })
  const selectedText = selected[0]?.type === 'text' ? selected[0].text : ''
  expect(selectedText).toContain('(tab tab-2,')
  const oldId = /Observation: ([^ ]+)/.exec(selectedText)?.[1]
  closed = true // Not browser_tabs close: emulate the user/site closing it.
  const result = await run(
    action,
    action === 'navigate'
      ? { url: 'http://fixture.test/after' }
      : action === 'click'
        ? { ref: 'e1', observationId: oldId }
        : {},
  )
  const text = result[0]?.type === 'text' ? result[0].text : ''
  expect(text).toContain('(tab tab-1,')
  if (action === 'click') expect(text).toContain('No action was dispatched')
  expect(fake.launches[0]?.clickCalls).toBe(0)
  const tabs = await run('tabs', { op: 'list' })
  expect(tabs[0]).toMatchObject({ type: 'text', text: expect.stringContaining('* tab-1') })
})

test('headed pool launch forwards explicit X11 and Wayland display access', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const previous = {
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  }
  process.env.DISPLAY = ':test-display'
  process.env.XAUTHORITY = '/test/xauthority'
  process.env.WAYLAND_DISPLAY = 'test-wayland'
  process.env.XDG_RUNTIME_DIR = '/test/runtime'
  try {
    await runner({ launch: fake.launcher }, admission)('headed-agent', config({ mode: 'headed' }))
    expect(fake.launches[0]?.input).toMatchObject({
      headless: false,
      display: ':test-display',
      xauthority: '/test/xauthority',
      waylandDisplay: 'test-wayland',
      xdgRuntimeDir: '/test/runtime',
    })
  } finally {
    await closeBrowserSession('headed-agent')
    if (previous.DISPLAY === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = previous.DISPLAY
    if (previous.XAUTHORITY === undefined) delete process.env.XAUTHORITY
    else process.env.XAUTHORITY = previous.XAUTHORITY
    if (previous.WAYLAND_DISPLAY === undefined) delete process.env.WAYLAND_DISPLAY
    else process.env.WAYLAND_DISPLAY = previous.WAYLAND_DISPLAY
    if (previous.XDG_RUNTIME_DIR === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previous.XDG_RUNTIME_DIR
  }
})

test('same-agent concurrent first use collapses into one launch', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const run = runner({ launch: fake.launcher }, admission)

  const [a, b, c] = await Promise.all([
    run('a1', config()),
    run('a1', config()),
    run('a1', config()),
  ])
  expect(fake.launches).toHaveLength(1)
  expect(a.length).toBeGreaterThan(0)
  expect(b.length).toBeGreaterThan(0)
  expect(c.length).toBeGreaterThan(0)
  expect(resources().browsers.get('a1')?.state).toBe('running')
  expect(resources().browsers.get('a1')?.busy).toBe(0)
})

test('close refuses an in-flight first action and can retire it after it settles', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdLaunches: true, holdNavigation: true })
  const run = runner({ launch: fake.launcher }, admission)

  const pending = run('a1', config(), 'navigate')
  await sleep(20)
  fake.launches[0]?.releaseLaunch()
  for (let attempt = 0; attempt < 20 && resources().browsers.get('a1')?.busy !== 1; attempt++) {
    await sleep(5)
  }
  await expect(closeBrowserSession('a1')).rejects.toMatchObject({ reasonCode: 'browser_busy' })
  fake.launches[0]?.releaseNavigation()
  await pending
  await closeBrowserSession('a1')

  expect(fake.launches[0]?.closeCalls).toBe(1)
  expect(resources().browsers.has('a1')).toBe(false)
})

test('reused sessions stay busy against close, reaping, config change and eviction', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdNavigation: true })
  const run = runner({ launch: fake.launcher }, admission)
  const cfg = config({ maxSessions: 1 })
  await run('a1', cfg)
  const entry = resources().browsers.get('a1')!
  expect(entry.busy).toBe(0)
  const pending = run('a1', cfg, 'navigate')
  await sleep(20)
  expect(entry.busy).toBe(1)
  await expect(closeBrowserSession('a1')).rejects.toMatchObject({ reasonCode: 'browser_busy' })
  await expect(entry.close()).rejects.toMatchObject({ reasonCode: 'browser_busy' })
  reapIdleBrowserSessions(Date.now() + 100_000)
  await expect(run('a1', config({ allowPrivate: false }))).rejects.toMatchObject({
    reasonCode: 'browser_busy',
  })
  await expect(run('a2', cfg)).rejects.toMatchObject({ reasonCode: 'browser_capacity_reached' })
  expect(fake.launches[0]?.closeCalls).toBe(0)
  fake.launches[0]?.releaseNavigation()
  await pending
  for (let i = 0; i < 3; i++) await run('a1', cfg)
  expect(entry.busy).toBe(0)
  await closeBrowserSession('a1')
  expect(fake.launches[0]?.closeCalls).toBe(1)
})

test('cancellation during startup retires the new handle without navigation', async () => {
  const controller = new AbortController()
  const admission = { ...makeAdmission(), signal: controller.signal }
  const fake = makeLauncher({ holdLaunches: true })
  const pending = runner({ launch: fake.launcher }, admission)('a1', config(), 'navigate')
  const rejected = expect(pending).rejects.toThrow(/cancelled/)
  await sleep(20)
  controller.abort()
  fake.launches[0]?.releaseLaunch()
  await rejected
  expect(fake.launches[0]?.navigationCalls).toBe(0)
  expect(fake.launches[0]?.closeCalls).toBe(1)
  expect(resources().browsers.has('a1')).toBe(false)
})

test('cancelled queued admission cannot reuse another turn session', async () => {
  const admission = makeAdmission()
  const controller = new AbortController()
  const fake = makeLauncher({ holdLaunches: true })
  const first = runner({ launch: fake.launcher }, admission)('a1', config())
  const pending = runner({ launch: fake.launcher }, { ...admission, signal: controller.signal })(
    'a1',
    config(),
    'navigate',
  )
  const rejected = expect(pending).rejects.toThrow(/cancelled/)
  await sleep(20)
  controller.abort()
  fake.launches[0]?.releaseLaunch()
  await first
  await rejected
  expect(fake.launches[0]?.navigationCalls).toBe(0)
  expect(fake.launches[0]?.closeCalls).toBe(0)
  expect(resources().browsers.get('a1')?.busy).toBe(0)
})

test.each([
  false,
  true,
])('cancellation retires active reused work; uncertain close=%s', async (failClose) => {
  const admission = makeAdmission()
  const controller = new AbortController()
  const fake = makeLauncher({ holdNavigation: true, failClose })
  const run = runner({ launch: fake.launcher }, { ...admission, signal: controller.signal })
  await run('a1', config())
  const entry = resources().browsers.get('a1')!
  const pending = run('a1', config(), 'navigate')
  const rejected = expect(pending).rejects.toThrow(failClose ? /cleanup is uncertain/ : /cancelled/)
  await sleep(20)
  controller.abort()
  // A cancellation response must not wait for a hung action to resolve.
  await rejected
  expect(fake.launches[0]?.closeCalls).toBe(1)
  expect(entry.busy).toBe(0)
  expect(resources().browsers.get('a1')?.state).toBe(failClose ? 'recovery_required' : undefined)
  fake.launches[0]?.releaseNavigation()
  await sleep(10)
  await expect(run('a1', config(), 'navigate')).rejects.toThrow(/cancelled/)
  expect(fake.launches[0]?.navigationCalls).toBe(1)
  expect(fake.launches).toHaveLength(1)
})

test('cancellation between fill and submit never sends the later keypress', async () => {
  const controller = new AbortController()
  const admission = { ...makeAdmission(), signal: controller.signal }
  const fake = makeLauncher({ holdFill: true })
  const deps = { launch: fake.launcher }
  const initial = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const first = initial[0]
  const observationId =
    first?.type === 'text' ? /Observation: ([^ ]+)/.exec(first.text)?.[1] : undefined
  expect(observationId).toBeTruthy()
  const pending = invokeBrowserAction(
    'a1',
    'type',
    { ref: 'e1', observationId, text: 'query', submit: true },
    config(),
    admission,
    deps,
  )
  const rejected = expect(pending).rejects.toThrow(/cancelled/)
  await sleep(20)
  expect(fake.launches[0]?.fillCalls).toBe(1)
  expect(resources().browsers.get('a1')?.busy).toBe(1)
  controller.abort()
  await rejected
  fake.launches[0]?.releaseFill()
  await sleep(20)
  expect(fake.launches[0]?.submitCalls).toBe(0)
  expect(fake.launches[0]?.closeCalls).toBe(1)
})

test('unproven cross-agent eviction retains capacity and refuses replacement launches', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ failClose: true })
  const run = runner({ launch: fake.launcher }, admission)
  const cfg = config({ maxSessions: 1 })
  await run('a1', cfg)
  await expect(run('a2', cfg)).rejects.toMatchObject({ reasonCode: 'browser_capacity_reached' })
  await expect(run('a3', cfg)).rejects.toMatchObject({ reasonCode: 'browser_capacity_reached' })
  expect(fake.launches).toHaveLength(1)
  expect(resources().browsers.get('a1')?.state).toBe('recovery_required')
})

test('overlapping actions cannot use one observation twice', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdClick: true })
  const deps = { launch: fake.launcher }
  const first = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    first[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(first[0].text)?.[1] : undefined
  const args = { observationId, ref: 'e1' }
  const click = invokeBrowserAction('a1', 'click', args, config(), admission, deps)
  for (let i = 0; fake.launches[0]?.clickCalls !== 1 && i < 50; i++) await sleep(5)
  expect(fake.launches[0]?.clickCalls).toBe(1)
  const second = invokeBrowserAction('a1', 'click', args, config(), admission, deps)
  await sleep(10)
  expect(fake.launches[0]?.clickCalls).toBe(1)
  fake.launches[0]?.releaseClick()
  await click
  const refused = await second
  expect(refused[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('No action was dispatched'),
  })
  expect(fake.launches[0]?.clickCalls).toBe(1)
})

test('forced retirement settles queued callers without waiting for a stuck action', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdClick: true })
  const deps = { launch: fake.launcher }
  const initial = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    initial[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(initial[0].text)?.[1] : undefined
  const first = invokeBrowserAction(
    'a1',
    'click',
    { ref: 'e1', observationId },
    config(),
    admission,
    deps,
  ).then(
    () => null,
    (error: unknown) => error,
  )
  for (let i = 0; fake.launches[0]?.clickCalls !== 1 && i < 50; i++) await sleep(5)
  expect(fake.launches[0]?.clickCalls).toBe(1)
  const queued = invokeBrowserAction(
    'a1',
    'press_key',
    { key: 'Enter' },
    config(),
    admission,
    deps,
  ).then(
    () => null,
    (error: unknown) => error,
  )
  const entry = resources().browsers.get('a1')
  if (!entry) throw new Error('missing browser entry')
  for (let i = 0; entry.busy !== 2 && i < 50; i++) await sleep(5)
  expect(entry.busy).toBe(2)
  await entry.close(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('retired callers did not settle')), 1_000)
  })
  try {
    const [actionError, queuedError] = await Promise.race([Promise.all([first, queued]), timeout])
    expect(actionError).toBeInstanceOf(Error)
    expect(queuedError).toBeInstanceOf(Error)
    expect((actionError as Error).message).toMatch(/retired|uncertain/)
    expect((queuedError as Error).message).toMatch(/retired|uncertain/)
    expect(entry.busy).toBe(0)
    expect(fake.launches[0]?.keypressCalls).toBe(0)
  } finally {
    if (timer) clearTimeout(timer)
    fake.launches[0]?.releaseClick()
  }
})

test('failed Enter invalidates the pre-effect observation and cannot re-authorize a click', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ failPressAfterEffect: true })
  const deps = { launch: fake.launcher }
  const first = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    first[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(first[0].text)?.[1] : undefined
  await expect(
    invokeBrowserAction('a1', 'press_key', { key: 'Enter' }, config(), admission, deps),
  ).rejects.toThrow(/failed after effect/)
  const refused = await invokeBrowserAction(
    'a1',
    'click',
    { ref: 'e1', observationId },
    config(),
    admission,
    deps,
  )
  expect(refused[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('No action was dispatched'),
  })
  expect(fake.launches[0]?.keypressCalls).toBe(1)
  expect(fake.launches[0]?.clickCalls).toBe(0)
})

test('browser errors, including blocked navigation schemes, stay within 32 KiB', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const deps = { launch: fake.launcher }
  const url = `${'x'.repeat(40_000)}:payload`
  const configWithGuard = config({ allowPrivate: false })
  const admitted = { ...admission, proxyUrl: 'http://127.0.0.1:1234' }
  const error = await invokeBrowserAction(
    'a1',
    'navigate',
    { url },
    configWithGuard,
    admitted,
    deps,
  ).then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(Error)
  expect(Buffer.byteLength((error as Error).message, 'utf8')).toBeLessThanOrEqual(32_768)
  expect((error as Error).message).toContain('blocked URL scheme')
  const host = createBrowserHost(config(), admission, async () => {
    throw new Error(`playwright error: ${'🚀'.repeat(20_000)}`)
  })
  const hostError = await host
    .invoke(admission.agentId, 'navigate', { url: 'http://fixture.test/' })
    .then(
      () => null,
      (reason: unknown) => reason,
    )
  expect(hostError).toBeInstanceOf(Error)
  expect(Buffer.byteLength((hostError as Error).message, 'utf8')).toBeLessThanOrEqual(32_768)
  const untyped = createBrowserHost(config(), admission, async () => {
    throw '🚀'.repeat(20_000)
  })
  const untypedError = await untyped.invoke(admission.agentId, 'click', { ref: 'e1' }).then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(untypedError).toBeInstanceOf(Error)
  expect((untypedError as Error).message).toMatch(/non-Error rejection; effects may be uncertain/)
  expect(Buffer.byteLength((untypedError as Error).message, 'utf8')).toBeLessThanOrEqual(32_768)
  // A thrown object must not have its attacker-supplied conversion hook invoked.
  let converted = false
  const objectHost = createBrowserHost(config(), admission, async () => {
    throw {
      toString: () => {
        converted = true
        throw new Error('should not stringify')
      },
    }
  })
  await expect(objectHost.invoke(admission.agentId, 'snapshot', {})).rejects.toThrow(/non-Error/)
  expect(converted).toBe(false)
})

test('ref mutation refuses changed or unknown document freshness before dispatch', async () => {
  for (const change of ['generation', 'document', 'unknown']) {
    const admission = makeAdmission()
    const fake = makeLauncher()
    const deps = { launch: fake.launcher }
    const first = await invokeBrowserAction(
      'a1',
      'navigate',
      { url: 'http://fixture.test/' },
      config(),
      admission,
      deps,
    )
    const part = first[0]
    const observationId =
      part?.type === 'text' ? /Observation: ([^ ]+)/.exec(part.text)?.[1] : undefined
    const record = fake.launches[0]
    if (!record) throw new Error('no fixture launch')
    if (change === 'generation') record.generation++
    if (change === 'document') record.documentId = 'replacement-document'
    if (change === 'unknown') record.statsAvailable = false
    const result = await invokeBrowserAction(
      'a1',
      'click',
      { observationId, ref: 'e1' },
      config(),
      admission,
      deps,
    )
    expect(record.clickCalls).toBe(0)
    expect(result[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/stale|freshness/),
    })
    await closeBrowserSession('a1')
  }
})

test('oversized or malformed refs refuse before any action, including all fields of a form', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const deps = { launch: fake.launcher }
  const first = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    first[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(first[0].text)?.[1] : undefined
  const oversized = `e${'9'.repeat(40_000)}`
  for (const ref of [oversized, 'e1\\nAccept', 'button >> e1']) {
    await expect(
      invokeBrowserAction('a1', 'click', { observationId, ref }, config(), admission, deps),
    ).rejects.toThrow(/ref must be an element ref/)
  }
  await expect(
    invokeBrowserAction(
      'a1',
      'fill_form',
      {
        observationId,
        fields: [
          { ref: 'e1', value: 'private' },
          { ref: oversized, value: 'x' },
        ],
      },
      config(),
      admission,
      deps,
    ),
  ).rejects.toThrow(/ref must be an element ref/)
  for (const fields of [
    [{ ref: 'e1', value: 'private' }, { value: 'missing ref' }],
    [
      { ref: 'e1', value: 'private' },
      { ref: 'e2', value: 123 },
    ],
    [{ ref: 'e1', value: 'private' }, null],
  ]) {
    await expect(
      invokeBrowserAction('a1', 'fill_form', { observationId, fields }, config(), admission, deps),
    ).rejects.toThrow(/field|ref/)
  }
  expect(fake.launches[0]?.clickCalls).toBe(0)
  expect(fake.launches[0]?.fillCalls).toBe(0)
  // Valid refs still use the existing freshness rule, with a bounded recovery.
  const record = fake.launches[0]
  if (!record) throw new Error('no fixture launch')
  record.generation++
  const stale = await invokeBrowserAction(
    'a1',
    'click',
    { observationId, ref: 'e1' },
    config(),
    admission,
    deps,
  )
  expect(stale[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('No action was dispatched'),
  })
  expect(
    stale[0]?.type === 'text' ? Buffer.byteLength(stale[0].text, 'utf8') : 0,
  ).toBeLessThanOrEqual(32_768)
  expect(record.clickCalls).toBe(0)
})

test('an action that takes effect then fails remains uncertain with a bounded result', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ clickError: `click failed after effect: ${'🚀'.repeat(20_000)}` })
  const deps = { launch: fake.launcher }
  const first = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    first[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(first[0].text)?.[1] : undefined
  const result = await invokeBrowserAction(
    'a1',
    'click',
    { observationId, ref: 'e1' },
    config(),
    admission,
    deps,
  )
  const message = result[0]?.type === 'text' ? result[0].text : ''
  expect(fake.launches[0]?.clickCalls).toBe(1)
  expect(message).toContain('may or may not have taken effect')
  expect(message).not.toContain('No action was dispatched')
  expect(message).toContain('Fresh observation:')
  expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(32_768)
  // A failed post-effect capture is bounded as well; the effect is still not replayed.
  await closeBrowserSession('a1')
  const fallback = makeLauncher({
    clickError: `click failed after effect: ${'🚀'.repeat(20_000)}`,
    failPostActionCapture: true,
  })
  const input = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    { launch: fallback.launcher },
  )
  const id = input[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(input[0].text)?.[1] : undefined
  const failed = await invokeBrowserAction(
    'a1',
    'click',
    { observationId: id, ref: 'e1' },
    config(),
    admission,
    { launch: fallback.launcher },
  )
  const failedText = failed[0]?.type === 'text' ? failed[0].text : ''
  expect(fallback.launches[0]?.clickCalls).toBe(1)
  expect(failedText).toContain('may or may not have taken effect')
  expect(failedText).toContain('A fresh observation was not possible')
  expect(Buffer.byteLength(failedText, 'utf8')).toBeLessThanOrEqual(32_768)
  // A failed recovery capture cannot revive the old ref even if the DOM is unchanged.
  await invokeBrowserAction('a1', 'click', { observationId: id, ref: 'e1' }, config(), admission, {
    launch: fallback.launcher,
  })
  expect(fallback.launches[0]?.clickCalls).toBe(1)
})

test('a failed post-action capture reports uncertainty without replaying the click', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ failPostActionCapture: true })
  const deps = { launch: fake.launcher }
  const first = await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const observationId =
    first[0]?.type === 'text' ? /Observation: ([^ ]+)/.exec(first[0].text)?.[1] : undefined
  const result = await invokeBrowserAction(
    'a1',
    'click',
    { observationId, ref: 'e1' },
    config(),
    admission,
    deps,
  )
  expect(fake.launches[0]?.clickCalls).toBe(1)
  expect(result[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('effect is unverified'),
  })
  expect(result[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Do not replay') })
  // The previously issued observation is invalidated even though capture failed.
  await invokeBrowserAction('a1', 'click', { observationId, ref: 'e1' }, config(), admission, deps)
  expect(fake.launches[0]?.clickCalls).toBe(1)
})

test('malformed large tab ids and unknown ops cannot produce unbounded responses', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const deps = { launch: fake.launcher }
  await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  const huge = '9'.repeat(40_000)
  for (const op of ['select', 'close']) {
    await expect(
      invokeBrowserAction('a1', 'tabs', { op, tabId: `tab-${huge}` }, config(), admission, deps),
    ).rejects.toThrow(/tabId must be a listed tab id/)
  }
  const missing = await invokeBrowserAction(
    'a1',
    'tabs',
    { op: 'close', tabId: 'tab-99999' },
    config(),
    admission,
    deps,
  )
  expect(missing[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('nothing to close'),
  })
  const error = await invokeBrowserAction(
    'a1',
    'tabs',
    { op: huge },
    config(),
    admission,
    deps,
  ).then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(Error)
  expect(Buffer.byteLength((error as Error).message, 'utf8')).toBeLessThanOrEqual(32_768)
})

test('snapshot scope rejects arbitrary selectors and conflicting modes at daemon dispatch', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const deps = { launch: fake.launcher }
  await invokeBrowserAction(
    'a1',
    'navigate',
    { url: 'http://fixture.test/' },
    config(),
    admission,
    deps,
  )
  for (const args of [
    { scope: 'body' },
    { scope: 'dialog >> button' },
    { scope: 1 },
    { scope: null },
    { scope: 'dialog', ref: 'e1' },
    { scope: 'dialog', cursor: 'old' },
    { ref: 'e1', cursor: 'old' },
  ]) {
    await expect(
      invokeBrowserAction('a1', 'snapshot', args, config(), admission, deps),
    ).rejects.toThrow(/scope|only one/)
  }
  const result = await invokeBrowserAction(
    'a1',
    'snapshot',
    { scope: 'dialog' },
    config(),
    admission,
    deps,
  )
  expect(result[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('Partial capture: dialog region only'),
  })
  expect(fake.launches[0]?.clickCalls).toBe(0)
})

test('at capacity with every session busy, admission is refused', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdNavigation: true })
  const run = runner({ launch: fake.launcher }, admission)
  const cfg = config({ maxSessions: 1 })

  const first = run('a1', cfg, 'navigate') // a1 busy: the navigation is held open
  await sleep(20)
  await expect(run('a2', cfg)).rejects.toMatchObject({
    reasonCode: 'browser_capacity_reached',
  })
  fake.launches[0]?.releaseNavigation()
  await first
  // Once a1's action finished (not busy), a2's admission retires a1 by LRU.
  await run('a2', cfg)
  expect(resources().browsers.has('a1')).toBe(false)
  expect(resources().browsers.has('a2')).toBe(true)
})

test('the reaper never reaps a busy session but reaps an idle one', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdNavigation: true })
  const run = runner({ launch: fake.launcher }, admission)
  const cfg = config({ idleMs: 1000 })

  const busy = run('a1', cfg, 'navigate') // in flight
  await sleep(20)
  reapIdleBrowserSessions(Date.now() + 100_000) // far future: idle past idleMs
  fake.launches[0]?.releaseNavigation()
  await busy
  expect(resources().browsers.has('a1')).toBe(true) // was busy during the reap

  reapIdleBrowserSessions(Date.now() + 100_000)
  await sleep(20) // the retirement settles (auto-released close)
  expect(resources().browsers.has('a1')).toBe(false)
  expect(fake.launches[0]?.closeCalls).toBe(1)
})

test('a failed close is not swallowed or reclassified as stopped', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ failClose: true })
  const run = runner({ launch: fake.launcher }, admission)

  await run('a1', config())
  expect(resources().browsers.get('a1')?.state).toBe('running')

  await expect(closeBrowserSession('a1')).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
  }) // the retirement failure must reach the lifecycle caller
  expect(resources().browsers.get('a1')?.state).toBe('recovery_required')

  // Snapshot/status calls cannot revive a denied session.
  await expect(run('a1', config())).rejects.toMatchObject({
    reasonCode: 'browser_recovery_required',
  })
  // And the launcher was not called again.
  expect(fake.launches).toHaveLength(1)
})

test('a configuration change retires the old session before the next admission', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher()
  const run = runner({ launch: fake.launcher }, admission)

  await run('a1', config({ allowPrivate: true }))
  const oldNonce = resources().browsers.get('a1')?.handle?.launchNonce

  // A different posture (proxy mode flips) must retire before re-admitting;
  // an unresolvable posture (headed without a display) fails admission
  // instead, which the executable/mode tests cover.
  await run('a1', config({ allowPrivate: false }))
  expect(fake.launches).toHaveLength(2)
  expect(oldNonce).not.toBe(resources().browsers.get('a1')?.handle?.launchNonce)
  expect(fake.launches[0]?.closeCalls).toBe(1) // the old session was retired
})

test('a stopping slot counts toward capacity until retirement is proved', async () => {
  const admission = makeAdmission()
  const fake = makeLauncher({ holdClose: true })
  const run = runner({ launch: fake.launcher }, admission)
  const cfg = config({ maxSessions: 1 })

  await run('a1', cfg)
  // a1 retires (stopping, held) while a2 asks for the only slot: the stopping
  // slot still counts, so a2 is refused rather than double-launching.
  const closing = closeBrowserSession('a1')
  await sleep(20)
  await expect(run('a2', cfg)).rejects.toBeInstanceOf(PoolError)
  fake.launches[0]?.releaseClose()
  await closing
  expect(resources().browsers.has('a1')).toBe(false)
})
