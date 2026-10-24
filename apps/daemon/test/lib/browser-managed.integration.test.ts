// T01 — managed-browser adapter verification lane (BAZ-069).
//
// OPT-IN: this suite only runs with BAZILION_TEST_BROWSER=1 and a provisioned
// supported browser on Linux or Apple Silicon macOS. Without the gate it skips with a reason; with
// the gate and a missing browser it FAILS (never silently skips). It never
// touches a public site: every destination is a loopback fixture, and the
// security assertions are exactly that those fixtures record ZERO hits.
//
// This is HEADLESS-lane evidence (explicit headless). GUI-dependent checks
// need a provisioned display and stay a separate lane (see the plan).
//
// Arms (fixtures in test/fixtures/browser-managed.ts):
// - POSTURE arm — full production options incl. the mandatory SSRF proxy with
//   `<-loopback>`: direct-spawn argv/env, sandbox on, owned loopback CDP,
//   loopback HTTP/iframe/WebSocket/popup denial, WebRTC/UDP denial.
// - CONTROL arm — denial args removed: records whether the WebRTC/UDP exposure
//   exists without the flags (evidence that the flags are load-bearing).
// - CONTEXT arm — no proxy (loopback fixture pages must be reachable; the
//   properties under test are proxy-independent): service-worker persistence,
//   download denial, bounded capture, cookie persistence across graceful
//   restart, and no surviving owned processes after close.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { type Paths, resolvePaths } from '../../src/core/paths.ts'
import {
  DIALOG_TARGET_PROTOTYPE_SCRIPT,
  DialogTargetPrototype,
} from '../../src/lib/browser/dialog-target-prototype.ts'
import { resolveBrowserExecutable } from '../../src/lib/browser/executable.ts'
import { launchManagedBrowser } from '../../src/lib/browser/launch.ts'
import { NativeObservationReader } from '../../src/lib/browser/native-observation-evidence.ts'
import { readDomStats, SessionObservations } from '../../src/lib/browser/observation.ts'
import { closeBrowserSession, invokeBrowserAction } from '../../src/lib/browser/pool.ts'
import {
  assessBrowserProfile,
  browserUserDataDir,
  readOwnerMarker,
  readSingletonLockPid,
} from '../../src/lib/browser/profile.ts'
import { closeSsrfProxy, getSsrfProxy } from '../../src/lib/browser/proxy.ts'
import { probeDarwinGuiSession } from '../../src/lib/process/darwin-gui.ts'
import { resources } from '../../src/lib/resources.ts'
import {
  createInstrumentedOrigin,
  createUdpProbe,
  type InstrumentedOrigin,
  launchLaneContext,
  MANAGED_DENIAL_ARGS,
  ownedBrowserProcesses,
  type UdpProbe,
} from '../fixtures/browser-managed.ts'

const gated = process.env.BAZILION_TEST_BROWSER === '1'
const exeResult = resolveBrowserExecutable(undefined)
if (gated && !exeResult.ok) {
  throw new Error(
    `BAZILION_TEST_BROWSER=1 requires a provisioned supported browser: ${exeResult.remedy}`,
  )
}
if (!gated) {
  console.log('[browser-managed] BAZILION_TEST_BROWSER is not set; skipping the opt-in lane')
}
const exe = exeResult.ok ? exeResult.candidate : null

const scratch = mkdtempSync(join(tmpdir(), 'baz069-t01-'))
// Mirror the production slot layout (D1): <slot>/{home,user-data}.
const postureSlot = join(scratch, 'posture-slot')
const controlSlot = join(scratch, 'control-slot')
const contextSlot = join(scratch, 'context-slot')
const postureProfile = join(postureSlot, 'user-data')
const controlProfile = join(controlSlot, 'user-data')
const contextProfile = join(contextSlot, 'user-data')

let instrumented: InstrumentedOrigin
let postureCtx: BrowserContext | null = null
let contextCtx: BrowserContext | null = null

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitForNoOwnedProcesses(profileDir: string, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ownedBrowserProcesses(profileDir).length === 0) return
    await sleep(250)
  }
  throw new Error(`owned browser processes for ${profileDir} did not exit within ${ms}ms`)
}

async function activePage(ctx: BrowserContext): Promise<Page> {
  return ctx.pages()[0] ?? (await ctx.newPage())
}

/** CDP uses the persistent default context: SWs may register and persist.
 * The network boundary is the proxy, tested on a persisted worker below. */
async function registerServiceWorker(page: Page): Promise<void> {
  await page.goto(instrumented.swPage, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction("document.title === 'SW-RESOLVED'")
  await page.waitForFunction(`navigator.serviceWorker.getRegistrations().then(
    registrations => registrations.length > 0 && registrations.every(r => r.active)
  )`)
  expect(instrumented.hits).toContain('/sw.js')
}

const run = gated && exe ? describe : describe.skip

run('managed browser adapter lane (BAZILION_TEST_BROWSER=1)', () => {
  const exePath = exe!.path

  beforeAll(async () => {
    // A planted provider-shaped secret must never reach the browser child:
    // the fixture env is an explicit allowlist, not an ambient copy.
    process.env.BAZILION_TEST_PLANTED_SECRET = 'sk-ant-t01-planted-not-a-real-key'
    instrumented = await createInstrumentedOrigin()
    const proxyUrl = await getSsrfProxy()
    postureCtx = await launchLaneContext({
      executablePath: exePath,
      profileDir: postureProfile,
      home: join(postureSlot, 'home'),
      headless: true,
      proxyUrl,
    })
  }, 120_000)

  afterAll(async () => {
    delete process.env.BAZILION_TEST_PLANTED_SECRET
    // Best-effort: the teardown test below owns the bounded-cleanup
    // assertion; if it failed partway, still try to retire everything here
    // without letting a stalled close hang the hook (a known proxy-close
    // defect T05 exists to fix — never let it obscure the suite result).
    const bestEffort = async (p: Promise<unknown> | undefined) => {
      if (!p) return
      await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 10_000))])
    }
    await bestEffort(postureCtx?.close().catch(() => {}))
    await bestEffort(contextCtx?.close().catch(() => {}))
    await bestEffort(instrumented?.close())
    await bestEffort(closeSsrfProxy())
    rmSync(scratch, { recursive: true, force: true })
  }, 60_000)

  test('argv pins direct local spawn: sandbox on, owned loopback CDP, proxy, denials, explicit binary', {
    timeout: 30_000,
  }, async () => {
    const procs = ownedBrowserProcesses(postureProfile)
    expect(procs.length).toBeGreaterThan(0)
    const root = procs.find((p) => p.kind === 'root')
    expect(root).toBeTruthy()
    const argv = root!.argv
    console.log('[browser-managed] root argv:', argv.join(' '))

    // Owned profile, explicit binary (no headless-shell substitution). The
    // resolved executable may itself be a distro wrapper script (Arch's
    // /usr/bin/chromium) that exec's the real binary — the running process
    // must be that Chromium binary, never a headless shell.
    expect(argv).toContain(`--user-data-dir=${postureProfile}`)
    expect(root!.exe).toBeTruthy()
    expect(root!.exe).not.toMatch(/headless[_-]?shell/i)
    expect(root!.exe).toMatch(/chrom/i)
    expect(existsSync(realpathSync(exePath))).toBe(true)

    // Native sandbox stays on; no security-weakening switches. Child cmdlines
    // are Chromium-rewritten single strings, so match on cmdline.
    expect(argv).not.toContain('--no-sandbox')
    expect(procs.some((p) => p.cmdline.includes('--no-sandbox'))).toBe(false)
    expect(argv).not.toContain('--disable-web-security')
    if (process.platform === 'linux') {
      expect(procs.some((p) => p.cmdline.includes('--type=zygote'))).toBe(true)
    } else if (process.platform === 'darwin') {
      // macOS has Seatbelt clients, not Linux's zygote architecture. Chromium's public
      // seatbelt_exec protocol requires this inherited policy channel before sandbox init.
      expect(
        procs.some(
          (p) => p.cmdline.includes('--type=renderer') && /--seatbelt-client=\d+/.test(p.cmdline),
        ),
      ).toBe(true)
    } else throw new Error('actual browser sandbox evidence is unavailable on this platform')

    // Nonzero loopback listener, directly spawned (not Playwright launch defaults).
    expect(argv.some((a) => /^--remote-debugging-port=[1-9]\d*$/.test(a))).toBe(true)
    expect(argv).toContain('--remote-debugging-address=127.0.0.1')
    expect(argv).not.toContain('--remote-debugging-pipe')
    expect(argv).not.toContain('--enable-automation')
    expect(argv).not.toContain('--disable-blink-features=AutomationControlled')
    expect(existsSync(join(postureProfile, 'DevToolsActivePort'))).toBe(false)

    // Mandatory proxy with Chromium's implicit loopback bypass disabled.
    expect(argv.some((a) => a.startsWith('--proxy-server='))).toBe(true)
    expect(argv.some((a) => a.startsWith('--proxy-bypass-list=<-loopback>'))).toBe(true)

    // Bazilion-authored denial args.
    for (const arg of MANAGED_DENIAL_ARGS) expect(argv).toContain(arg)

    // Native identity, not a synthetic webdriver value. Direct/CDP and
    // Playwright-launched Chromium need not report the same native value.
    const posturePage = await activePage(postureCtx!)
    expect(
      await posturePage.evaluate(
        "Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver').get.toString()",
      ),
    ).toContain('[native code]')
    expect(await posturePage.evaluate('navigator.userAgent')).toMatch(/HeadlessChrome\//)

    // Explicit headless for this lane.
    expect(argv.some((a) => a.startsWith('--headless'))).toBe(true)
  })

  test('the child env is a scrubbed allowlist; ambient secrets never reach the browser', {
    timeout: 30_000,
  }, () => {
    const root = ownedBrowserProcesses(postureProfile).find((p) => p.kind === 'root')
    expect(root).toBeTruthy()
    const env = root!.environ
    const keys = env.map((e) => e.split('=')[0] ?? '')

    // Nothing ambient leaks: no planted provider secret, no proxy vars.
    expect(env.some((e) => e.includes('sk-ant-t01-planted-not-a-real-key'))).toBe(false)
    for (const banned of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'XDG_CONFIG_HOME',
    ]) {
      expect(keys).not.toContain(banned)
    }

    // Everything present is the allowlist, display access when headed, or
    // CHROME_* vars added by the executable's own distro wrapper (Arch's
    // /usr/bin/chromium is a shell script that sets CHROME_WRAPPER,
    // CHROME_DESKTOP and CHROME_VERSION_EXTRA before exec'ing the real
    // binary — observed; it adds nothing else and removes nothing). TMPDIR is
    // deliberately absent: Chromium's singleton socket path is capped by
    // sockaddr_un (~104 bytes) and an in-slot TMPDIR aborts deep-path
    // launches (T01-verified 2026-09-25).
    expect(keys).toContain('PATH')
    expect(keys).toContain('LANG')
    const allowed =
      /^(PATH|HOME|LANG|DISPLAY|XAUTHORITY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|CHROME_[A-Z0-9_]+)$/
    expect(keys.filter((key) => !allowed.test(key))).toEqual([])
    expect(env).toContain(`HOME=${join(postureSlot, 'home')}`)
    expect(keys).not.toContain('TMPDIR')
  })

  test('loopback HTTP/iframe/WebSocket/popup egress hits zero instrumented targets', {
    timeout: 60_000,
  }, async () => {
    const ctx = postureCtx!
    const page = await activePage(ctx)
    const results = (await page.evaluate(
      `(async () => {
        const origin = ${JSON.stringify(instrumented.origin)}
        const out = {}
        try {
          const res = await fetch(origin + '/probe', { mode: 'no-cors' })
          out.fetch = 'status:' + res.status
        } catch (e) {
          out.fetch = 'rejected:' + e.name
        }
        await new Promise((resolve) => {
          const f = document.createElement('iframe')
          f.src = origin + '/probe'
          f.onload = () => { out.iframe = out.iframe || 'loaded'; resolve() }
          f.onerror = () => { out.iframe = out.iframe || 'error'; resolve() }
          document.body.appendChild(f)
          setTimeout(resolve, 3000)
        })
        await new Promise((resolve) => {
          try {
            const ws = new WebSocket('ws://' + new URL(origin).host + '/probe')
            ws.onopen = () => { out.websocket = out.websocket || 'open'; resolve() }
            ws.onerror = () => { out.websocket = out.websocket || 'error'; resolve() }
            setTimeout(() => { out.websocket = out.websocket || 'timeout'; resolve() }, 3000)
          } catch {
            out.websocket = 'threw'
            resolve()
          }
        })
        return out
      })()`,
    )) as unknown as Record<string, string>
    console.log('[browser-managed] loopback egress attempt results:', JSON.stringify(results))

    // Popup (click-triggered, so Chromium's popup blocker is not the denier).
    await page.setContent(
      `<button id="open">open</button><script>document.getElementById('open').addEventListener('click', () => window.open('${instrumented.origin}/probe'))</script>`,
    )
    const before = ctx.pages().length
    await page.click('#open')
    await page.waitForTimeout(1_000)
    expect(ctx.pages().length).toBeGreaterThan(before)

    // The security assertion: the instrumented fixture saw NOTHING.
    expect(instrumented.hits).toHaveLength(0)
  })

  test('WebRTC cannot send UDP to a loopback listener under the pinned policy', {
    timeout: 60_000,
  }, async () => {
    const probe: UdpProbe = await createUdpProbe()
    try {
      const page = await activePage(postureCtx!)
      await page.goto('about:blank')
      await page.setContent('<iframe srcdoc="<p>dynamic frame</p>"></iframe>')
      await expect.poll(() => page.frames().length).toBe(2)
      const attempts: Array<{ name: string; api: string; steps: string[] }> = []
      // Exercise every alias in both the top document and a dynamic frame.
      // If a constructor survives, the offer/answer + injected candidate must
      // actually attempt UDP; merely checking an API name is insufficient.
      for (const frame of page.frames()) {
        await frame.waitForLoadState('domcontentloaded')
        for (const name of [
          'RTCPeerConnection',
          'webkitRTCPeerConnection',
          'mozRTCPeerConnection',
        ]) {
          attempts.push(
            await frame.evaluate(`(async () => {
            const name = ${JSON.stringify(name)}
            const result = { name, api: typeof window[name], steps: [] }
            try {
              const remote = new window[name]()
              const pc = new window[name]()
              ;(window.__probePeers ??= []).push(remote, pc)
              remote.createDataChannel('probe')
              const offer = await remote.createOffer()
              await remote.setLocalDescription(offer)
              await pc.setRemoteDescription(offer)
              await pc.setLocalDescription(await pc.createAnswer())
              result.steps.push('signaled')
              await pc.addIceCandidate({
                candidate: 'candidate:1 1 UDP 1 127.0.0.1 ${probe.port} typ host',
                sdpMid: '0', sdpMLineIndex: 0,
              })
              result.steps.push('ice-added')
            } catch (e) { result.steps.push('error:' + e.name) }
            return result
          })()`),
          )
        }
      }
      await page.waitForTimeout(4_000)
      for (const frame of page.frames())
        await frame.evaluate('window.__probePeers?.forEach(pc => pc.close())')
      console.log('[browser-managed] all WebRTC aliases/frames:', JSON.stringify(attempts))
      expect(attempts).toHaveLength(6)
      expect(
        attempts.every((a) => a.api === 'undefined' && a.steps.join(' ') === 'error:TypeError'),
      ).toBe(true)
      expect(probe.datagrams).toHaveLength(0)
    } finally {
      await probe.close()
    }
  })

  test('control arm (denials removed) demonstrates the WebRTC/UDP exposure', {
    timeout: 120_000,
  }, async () => {
    const probe = await createUdpProbe()
    // denialArgs: [] launches raw — no authored denials, no guards — so the
    // control arm records what an uncontrolled posture exposes.
    const ctx = await launchLaneContext({
      executablePath: exePath,
      profileDir: controlProfile,
      home: join(controlSlot, 'home'),
      headless: true,
      denialArgs: [],
    })
    try {
      const root = ownedBrowserProcesses(controlProfile).find((p) => p.kind === 'root')
      expect(root).toBeTruthy()
      for (const arg of MANAGED_DENIAL_ARGS) {
        expect(root!.argv).not.toContain(arg)
      }
      const page = await activePage(ctx)
      await page.evaluate(
        `(async () => {
          const port = ${probe.port}
          const remote = new RTCPeerConnection()
          remote.createDataChannel('probe')
          const offer = await remote.createOffer()
          await remote.setLocalDescription(offer)
          const pc = new RTCPeerConnection()
          await pc.setRemoteDescription(offer)
          await pc.setLocalDescription(await pc.createAnswer())
          return pc
            .addIceCandidate({
              candidate: 'candidate:1 1 UDP 1 127.0.0.1 ' + port + ' typ host',
              sdpMid: '0',
              sdpMLineIndex: 0,
            })
            .then(() => 'attempted')
            .catch((e) => 'error:' + e.name)
        })()`,
      )
      await page.waitForTimeout(4_000)
      // The exposure is real and demonstrated: without the controls, the page
      // drives direct STUN binding requests to an arbitrary loopback address,
      // bypassing the proxy entirely (65 observed across probes). This is what
      // makes the managed arm's controls load-bearing rather than decorative.
      console.log('[browser-managed] control-arm loopback UDP datagrams:', probe.datagrams.length)
      expect(probe.datagrams.length).toBeGreaterThan(0)
    } finally {
      await ctx.close()
      await probe.close()
    }
    await waitForNoOwnedProcesses(controlProfile)
  })

  test('CDP default context retains service workers; no unsupported block setting is claimed', {
    timeout: 120_000,
  }, async () => {
    contextCtx = await launchLaneContext({
      executablePath: exePath,
      profileDir: contextProfile,
      home: join(contextSlot, 'home'),
      headless: true,
    })
    await registerServiceWorker(await activePage(contextCtx))
  })

  test('downloads are denied by explicit CDP policy; managed download locations stay empty', {
    timeout: 60_000,
  }, async () => {
    const page = await activePage(contextCtx!)
    await page.goto(instrumented.downloadPage, { waitUntil: 'domcontentloaded' })
    const downloadPromise = page.waitForEvent('download')
    await page.click('#dl')
    const download = await downloadPromise
    expect(await download.failure()).toBeTruthy()
    expect(existsSync(join(contextSlot, 'home', 'Downloads', 'probe.bin'))).toBe(false)
    const dlDir = join(contextProfile, 'downloads')
    const files = existsSync(dlDir) ? readdirSync(dlDir) : []
    expect(files).toEqual([])
  })

  test('bounded capture is available and measurable (input for T08 paging)', {
    timeout: 60_000,
  }, async () => {
    const page = await activePage(contextCtx!)
    await page.goto(instrumented.bigPage, { waitUntil: 'domcontentloaded' })
    // The capture API exposes depth/timeout, not a byte bound: byte-bounding
    // and UTF-8-safe paging are a daemon-side wrapper (T08's job).
    const snap = await page.locator('body').ariaSnapshot({ mode: 'ai' })
    expect(typeof snap).toBe('string')
    const bytes = Buffer.byteLength(snap, 'utf8')
    console.log('[browser-managed] ariaSnapshot byteLength on the big DOM:', bytes)
    expect(bytes).toBeGreaterThan(50_000)
  })

  test('graceful restart: cookies persist and persisted service-worker egress stays behind proxy', {
    timeout: 120_000,
  }, async () => {
    const ctx = contextCtx!
    await ctx.addCookies([
      {
        name: 'baz069-t01',
        value: 'persisted',
        url: instrumented.origin,
        expires: Math.floor(Date.now() / 1000) + 3_600,
      },
    ])
    await ctx.close()
    contextCtx = null
    await waitForNoOwnedProcesses(contextProfile)

    // Keep every target hit across the ENTIRE restart, not just after attach.
    instrumented.hits.length = 0
    let beforeGuardsText = ''
    const relaunched = await launchLaneContext({
      executablePath: exePath,
      profileDir: contextProfile,
      home: join(contextSlot, 'home'),
      headless: true,
      proxyUrl: await getSsrfProxy(),
      beforeGuards: async (context) => {
        const page = await activePage(context)
        // Force the persisted worker to execute while document guards are not
        // installed. The startup proxy, not route/init interception, must deny.
        await page.goto(`${instrumented.origin}/sw-scope/startup`, {
          waitUntil: 'domcontentloaded',
        })
        beforeGuardsText = await page.locator('body').innerText()
        expect(beforeGuardsText).toContain('persisted-worker-active')
        expect(beforeGuardsText).toMatch(/network-(blocked|status:403)/)
        expect(instrumented.hits).toEqual([])
      },
    })
    try {
      const cookies = await relaunched.cookies()
      expect(cookies.some((c) => c.name === 'baz069-t01' && c.value === 'persisted')).toBe(true)
      expect(beforeGuardsText).toContain('persisted-worker-active')
      const page = await activePage(relaunched)
      await page.goto(`${instrumented.origin}/sw-scope/check`, { waitUntil: 'domcontentloaded' })
      const text = await page.locator('body').innerText()
      expect(text).toContain('persisted-worker-active')
      expect(text).toMatch(/network-(blocked|status:403)/)
      expect(text).toContain('p2p:undefined')
      expect(instrumented.hits).toEqual([])
    } finally {
      await relaunched.close()
    }
    await waitForNoOwnedProcesses(contextProfile)
  })

  test.each([
    'light',
    'shadow',
    'dynamic-shadow',
  ])('real ref mutations refuse changed accessible meaning and accept a fresh observation (%s)', {
    timeout: 60_000,
  }, async (mode) => {
    const paths = resolvePaths(join(scratch, 'freshness'))
    const agentId = 'freshness'
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const deps = { daemonInstanceId: 'freshness-fixture-daemon' }
    try {
      await invokeBrowserAction(agentId, 'snapshot', {}, config, admission, deps)
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('fixture context unavailable')
      const button =
        '<button aria-label="Before" onclick="window.clicks = (window.clicks || 0) + 1">Action</button>'
      await context.route('**/freshness', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body:
            mode === 'shadow'
              ? `<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML = ${JSON.stringify(button)}</script>`
              : `<div id="host"></div>${button}`,
        }),
      )
      const first = await invokeBrowserAction(
        agentId,
        'navigate',
        { url: `${instrumented.origin}/freshness` },
        config,
        admission,
        deps,
      )
      const firstText = first[0]?.type === 'text' ? first[0].text : ''
      const ref = /button .*\[ref=(e\d+)\]/.exec(firstText)?.[1]
      const observationId = /Observation: ([^ ]+)/.exec(firstText)?.[1]
      expect(ref, firstText).toBeTruthy()
      const page = await activePage(context)
      await page.evaluate(
        mode === 'dynamic-shadow'
          ? `document.querySelector('#host').attachShadow({mode:'open'}).innerHTML = '<span>New state</span>'`
          : `(document.querySelector('button') || document.querySelector('#host').shadowRoot.querySelector('button')).setAttribute('aria-label', 'Changed meaning')`,
      )
      const denied = await invokeBrowserAction(
        agentId,
        'click',
        { ref, observationId },
        config,
        admission,
        deps,
      )
      const deniedText = denied[0]?.type === 'text' ? denied[0].text : ''
      expect(deniedText).toContain('stale')
      expect(await page.evaluate('window.clicks || 0')).toBe(0)
      const freshId = /Observation: ([^ ]+)/.exec(deniedText)?.[1]
      const freshRef = /button .*\[ref=(e\d+)\]/.exec(deniedText)?.[1]
      await invokeBrowserAction(
        agentId,
        'click',
        { ref: freshRef, observationId: freshId },
        config,
        admission,
        deps,
      )
      expect(await page.evaluate('window.clicks')).toBe(1)
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test.each([
    true,
    false,
  ])('post-click body settling is bounded and never replays the action (restores=%s)', {
    timeout: 60_000,
  }, async (restores) => {
    const agentId = 'capture-settling'
    const paths = resolvePaths(join(scratch, agentId))
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const deps = { daemonInstanceId: 'capture-fixture-daemon' }
    try {
      await invokeBrowserAction(agentId, 'snapshot', {}, config, admission, deps)
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/settling', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `
        <button>Continue</button><script>
        window.clicks = 0;
        document.querySelector('button').onclick = () => {
          window.clicks++; document.body.remove();
          ${restores ? "setTimeout(() => { const body = document.createElement('body'); body.innerHTML = '<main>Destination ready</main>'; document.documentElement.appendChild(body) }, 250)" : ''}
        };</script>`,
        }),
      )
      const first = await invokeBrowserAction(
        agentId,
        'navigate',
        { url: `${instrumented.origin}/settling` },
        config,
        admission,
        deps,
      )
      const firstText = first[0]?.type === 'text' ? first[0].text : ''
      const observationId = /Observation: ([^ ]+)/.exec(firstText)?.[1]
      const ref = /button .*\[ref=(e\d+)\]/.exec(firstText)?.[1]
      const result = await invokeBrowserAction(
        agentId,
        'click',
        { observationId, ref },
        config,
        admission,
        deps,
      )
      const resultText = result[0]?.type === 'text' ? result[0].text : ''
      expect(resultText).toContain(restores ? 'Destination ready' : 'effect is unverified')
      expect(await (await activePage(context)).evaluate('window.clicks')).toBe(1)
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('R12 captures a small body below an oversized head without a native main', {
    timeout: 60_000,
  }, async () => {
    const agentId = 'semantic-head'
    const paths = resolvePaths(join(scratch, agentId))
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    try {
      await invokeBrowserAction(agentId, 'snapshot', {}, config, admission, {
        daemonInstanceId: 'semantic-fixture-daemon',
      })
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/large-head', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><head><script type="application/json">${'x'.repeat(700_000)}</script></head><body><button>Readable control</button></body></html>`,
        }),
      )
      const result = await invokeBrowserAction(
        agentId,
        'navigate',
        { url: `${instrumented.origin}/large-head` },
        config,
        admission,
        { daemonInstanceId: 'semantic-fixture-daemon' },
      )
      const value = result[0]?.type === 'text' ? result[0].text : ''
      expect(value).toContain('Complete capture: yes')
      expect(value).toContain('Readable control')
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('R12 recovers hydrated ARIA main and consent dialog without stale clicks', {
    timeout: 60_000,
  }, async () => {
    const agentId = 'semantic-hydration'
    const paths = resolvePaths(join(scratch, agentId))
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const run = (action: string, args: Record<string, unknown> = {}) =>
      invokeBrowserAction(agentId, action, args, config, admission, {
        daemonInstanceId: 'semantic-fixture-daemon',
      })
    const value = (parts: Awaited<ReturnType<typeof run>>) =>
      parts[0]?.type === 'text' ? parts[0].text : ''
    const id = (text: string) => /Observation: ([^ ]+)/.exec(text)?.[1]
    try {
      await run('snapshot')
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/hydration', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<div role="main"><div role="search"><input aria-label="Search"><button>Find</button></div></div><aside>Outside</aside>',
        }),
      )
      const first = value(await run('navigate', { url: `${instrumented.origin}/hydration` }))
      const page = await activePage(context)
      await page.evaluate(`(() => {
        window.rejects = 0; window.accepts = 0;
        for (const parent of [document.head, document.body]) { const bulky = document.createElement('script'); bulky.type = 'application/json'; bulky.textContent = 'x'.repeat(700000); parent.appendChild(bulky) }
        const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<button>Reject</button><button>Accept</button>';
        dialog.children[0].onclick = () => { window.rejects++; dialog.remove() };
        dialog.children[1].onclick = () => { window.accepts++ };
        document.body.appendChild(dialog);
      })()`)
      const main = value(await run('snapshot'))
      expect(main).toContain('Partial capture: main region only')
      expect(main).toContain('Search')
      const search = value(await run('snapshot', { scope: 'search' }))
      expect(search).toContain('Partial capture: search region only')
      expect(search).toContain('Search')
      const dialog = value(await run('snapshot', { scope: 'dialog' }))
      expect(dialog).toContain('Partial capture: dialog region only')
      const ref = /button "Reject" \[ref=(e\d+)\]/.exec(dialog)?.[1]
      expect(ref).toBeTruthy()
      // A fresh narrow capture does not relax full-document freshness.
      await page.locator('aside').evaluate((el) => {
        el.textContent = 'Changed outside dialog'
      })
      const stale = value(await run('click', { ref, observationId: id(dialog) }))
      expect(stale).toMatch(/stale|page changed/)
      expect(await page.evaluate('window.rejects')).toBe(0)
      const refreshed = value(await run('snapshot', { scope: 'dialog' }))
      const freshRef = /button "Reject" \[ref=(e\d+)\]/.exec(refreshed)?.[1]
      await run('click', { ref: freshRef, observationId: id(first) })
      expect(await page.evaluate('window.rejects')).toBe(0)
      const current = value(await run('snapshot', { scope: 'dialog' }))
      await run('click', {
        ref: /button "Reject" \[ref=(e\d+)\]/.exec(current)?.[1],
        observationId: id(current),
      })
      expect(await page.evaluate('({ rejects: window.rejects, accepts: window.accepts })')).toEqual(
        { rejects: 1, accepts: 0 },
      )
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('a dynamic banner refuses stale search submission; a settled page accepts fresh refs', {
    timeout: 60_000,
  }, async () => {
    const agentId = 'dynamic-search-consent'
    const paths = resolvePaths(join(scratch, agentId))
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const run = (action: string, args: Record<string, unknown> = {}) =>
      invokeBrowserAction(agentId, action, args, config, admission, {
        daemonInstanceId: 'dynamic-search-fixture-daemon',
      })
    const value = (parts: Awaited<ReturnType<typeof run>>) =>
      parts[0]?.type === 'text' ? parts[0].text : ''
    const id = (text: string) => /Observation: ([^ ]+)/.exec(text)?.[1]
    const inputRef = (text: string) => /textbox "Search"[^\n]*\[ref=(e\d+)\]/.exec(text)?.[1]
    try {
      await run('snapshot')
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/dynamic-search', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<div role="search"><input aria-label="Search"></div><aside>News</aside>',
        }),
      )
      const first = value(await run('navigate', { url: `${instrumented.origin}/dynamic-search` }))
      expect(inputRef(first), first).toBeTruthy()
      const page = await activePage(context)
      await page.evaluate(`(() => {
        window.submits = 0; window.rejects = 0; window.accepts = 0;
        document.querySelector('input').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') window.submits++;
        });
        const banner = document.createElement('section');
        banner.innerHTML = '<p>Accept enables optional ads. Reject declines those uses.</p>' +
          '<button onclick="window.rejects++; this.parentElement.remove()">Reject</button>' +
          '<button onclick="window.accepts++">Accept</button>';
        document.body.appendChild(banner);
      })()`)
      const refused = value(
        await run('type', {
          ref: inputRef(first),
          observationId: id(first),
          text: 'NASA',
          submit: true,
        }),
      )
      expect(refused).toContain('stale')
      expect(refused).toContain('No action was dispatched')
      expect(refused).toContain('Reject declines those uses')
      expect(await page.evaluate('window.submits')).toBe(0)
      expect(await page.locator('input').inputValue()).toBe('')

      const search = value(await run('snapshot', { scope: 'search' }))
      expect(search).toContain('Partial capture: search region only')
      await page.locator('aside').evaluate((el) => {
        el.textContent = 'Updated news'
      })
      const again = value(
        await run('type', {
          ref: inputRef(search),
          observationId: id(search),
          text: 'NASA',
          submit: true,
        }),
      )
      expect(again).toContain('stale')
      expect(again).toContain('No action was dispatched')
      expect(await page.evaluate('window.submits')).toBe(0)
      expect(await page.locator('input').inputValue()).toBe('')
      expect(await page.evaluate('window.rejects + window.accepts')).toBe(0)

      // This fixture exercises dispatch semantics, NOT Agent consent judgment.
      // Once the page settles, a new observation authorizes the same control.
      // Neither earlier refused submission was replayed implicitly.
      const current = value(await run('snapshot'))
      const submitted = value(
        await run('type', {
          ref: inputRef(current),
          observationId: id(current),
          text: 'NASA',
          submit: true,
        }),
      )
      expect(submitted).not.toContain('Could not act on ref')
      expect(await page.evaluate('window.submits')).toBe(1)
      expect(await page.evaluate('window.rejects + window.accepts')).toBe(0)
      // A failure after the action boundary cannot make the same no-effect claim.
      const uncertain = value(await run('click', { ref: 'e9999', observationId: id(submitted) }))
      expect(uncertain).toContain('may or may not have taken effect')
      expect(uncertain).not.toContain('No action was dispatched')
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('native whole-document evidence distinguishes no-op writes without excluding outside context', {
    timeout: 90_000,
  }, async () => {
    const agentId = 'native-observation-evidence'
    const admission = {
      paths: resolvePaths(join(scratch, agentId)),
      agentId,
      teamId: 'fixture-team',
    }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const run = (action: string, args: Record<string, unknown> = {}) =>
      invokeBrowserAction(agentId, action, args, config, admission, {
        daemonInstanceId: 'native-observation-fixture-daemon',
      })
    try {
      await run('snapshot')
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/native-evidence', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body:
            '<style>body:has(#ticker:empty){opacity:0}</style>' +
            '<div role="dialog" style="position:fixed;left:80px;top:80px;width:300px">' +
            '<p style="height:42px">Reject declines optional analytics.</p>' +
            '<button data-state="ready" onclick="window.rejects=(window.rejects||0)+1">Reject</button></div>' +
            '<div id="outside" style="position:fixed;left:80px;top:35px">Reject declines optional uses</div>' +
            '<aside id="ticker" style="position:absolute;left:800px;top:800px">News 1</aside>' +
            '<input type="hidden" name="decision" value="decline">' +
            '<canvas width="20" height="20"></canvas>',
        }),
      )
      const page = await activePage(context)
      const cases: Array<[string, string, boolean, string?]> = [
        [
          'no-op attribute',
          "const b = document.querySelector('button'); b.setAttribute('data-state', b.getAttribute('data-state'))",
          true,
        ],
        [
          'no-op character data',
          "const t = document.querySelector('#ticker').firstChild; t.data = t.data",
          true,
        ],
        [
          'outside context',
          "document.querySelector('#outside').firstChild.data = 'Reject permits analytics'",
          false,
        ],
        ['ticker changed', "document.querySelector('#ticker').firstChild.data = 'News 2'", false],
        ['ancestor opacity', "document.querySelector('#ticker').firstChild.data = ''", false],
        [
          'closed shadow',
          "document.querySelector('p').attachShadow({mode:'closed'}).innerHTML = 'Reject grants tracking'",
          false,
        ],
        [
          'handler replacement',
          "document.querySelector('button').onclick = () => { window.accepts = 1 }",
          false,
        ],
        ['CSSOM mutation', "document.styleSheets[0].insertRule('button{opacity:0}',0)", false],
        ['live hidden input', "document.querySelector('input').value = 'accept'", false],
        [
          'canvas pixels',
          "const c = document.querySelector('canvas').getContext('2d'); c.fillRect(0,0,20,20)",
          false,
        ],
        [
          'same-label replacement',
          "const b = document.querySelector('button'); b.replaceWith(b.cloneNode(true))",
          false,
        ],
        [
          'page prototype tampering',
          "JSON.stringify = () => 'forged'; Map.prototype.get = () => ({baseline:'forged'}); document.querySelector('p').firstChild.data = 'Reject permits tracking'",
          false,
        ],
      ]
      // Known gaps are NOT authorizable equality cases. The reader explicitly
      // returns unqualified coverage/coherence, rather than a freshness permit.
      cases.push(
        [
          'known gap: off-viewport canvas',
          "document.querySelector('canvas').getContext('2d').fillRect(0,0,20,20)",
          true,
          "document.querySelector('canvas').style.cssText = 'position:fixed;top:3000px;left:0'",
        ],
        [
          'known gap: off-viewport omitted style',
          "document.styleSheets[0].insertRule('#outside{outline:3px dotted red}',0)",
          true,
          "document.querySelector('#outside').style.top = '3000px'",
        ],
      )
      for (const [name, mutation, equivalent, setup] of cases) {
        await run('navigate', { url: `${instrumented.origin}/native-evidence` })
        if (setup) await page.evaluate(setup)
        const reader = await NativeObservationReader.create(page)
        try {
          const before = await reader.read()
          const stable = await reader.read()
          expect(before.kind, name).toBe('captured')
          expect(stable.kind, name).toBe('captured')
          if (before.kind !== 'captured' || stable.kind !== 'captured')
            throw new Error('missing native evidence')
          expect(stable.digest, `stable baseline: ${name}`).toBe(before.digest)
          const observed = await readDomStats(page)
          await page.evaluate(mutation)
          if (equivalent && name.startsWith('no-op')) {
            const changed = await readDomStats(page)
            if (!observed || !changed) throw new Error('missing fixture mutation stats')
            expect(changed.generation, name).toBeGreaterThan(observed.generation)
          }
          const after = await reader.read()
          expect(after.kind, name).toBe('captured')
          if (after.kind !== 'captured') throw new Error('missing native evidence after mutation')
          expect(after.digest === before.digest, name).toBe(equivalent)
          expect(await page.evaluate('window.rejects || 0'), name).toBe(0)
        } finally {
          await reader.dispose()
        }
      }
      await run('navigate', { url: `${instrumented.origin}/native-evidence` })
      const observations = new SessionObservations(agentId)
      const reader = await NativeObservationReader.create(page)
      try {
        const candidate = await reader.capturePublicationCandidate(observations, {
          agentId,
          tabId: observations.registerTab(page),
          page,
        })
        expect(candidate.evidence.observationId).toBe(observations.getCurrentObservationId())
        expect(candidate.observation.text).toContain('Reject declines optional analytics')
        expect(candidate.evidence.sample.coverage).toBe('unqualified')
        expect(candidate.evidence.sample.coherence).toBe('unqualified')
        await page.evaluate(
          "const b=document.querySelector('button'); b.setAttribute('data-state', b.getAttribute('data-state'))",
        )
        // No diagnostic candidate permits ignoring the production generation.
        await expect(observations.assertFresh(page)).rejects.toThrow(/page changed/)
        expect(await page.evaluate('window.rejects || 0')).toBe(0)
      } finally {
        await reader.dispose()
      }
      const extra = await context.newPage()
      await extra.goto(`${instrumented.origin}/native-evidence`)
      const selected = await run('tabs', { op: 'select', tabId: 'tab-2' })
      expect(selected[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('(tab tab-2,'),
      })
      await extra.close() // The site/operator, not browser_tabs, closed it.
      const fallback = await run('snapshot')
      expect(fallback[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('(tab tab-1,'),
      })
      const tabs = await run('tabs', { op: 'list' })
      expect(tabs[0]).toMatchObject({ type: 'text', text: expect.stringContaining('* tab-1') })
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('offline dialog-target prototype distinguishes a ticker from changed control evidence', {
    timeout: 90_000,
  }, async () => {
    const agentId = 'dialog-target-prototype'
    const admission = {
      paths: resolvePaths(join(scratch, agentId)),
      agentId,
      teamId: 'fixture-team',
    }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const run = (action: string, args: Record<string, unknown> = {}) =>
      invokeBrowserAction(agentId, action, args, config, admission, {
        daemonInstanceId: 'dialog-prototype-fixture-daemon',
      })
    try {
      await run('snapshot')
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      // Only this test installs the candidate; managed guards/pool do not.
      await context.addInitScript(DIALOG_TARGET_PROTOTYPE_SCRIPT)
      await context.route('**/target-prototype', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body:
            '<style>body:has(aside:empty) [role=dialog] p {visibility:hidden}' +
            'body:has(#opacity:empty){opacity:0}</style>' +
            '<div role="dialog" style="position:fixed;left:80px;top:80px;width:300px">' +
            '<p style="height:42px">Reject declines optional analytics. Accept permits them.</p>' +
            '<button onclick="window.rejects=(window.rejects||0)+1">Reject</button></div>' +
            '<aside style="position:absolute;left:800px;top:800px">News 1</aside>' +
            '<div id="opacity" style="position:absolute;left:800px;top:850px">Visible</div>' +
            '<div id="outside" style="position:fixed;left:80px;top:35px">Reject declines optional uses</div>',
        }),
      )
      const page = await activePage(context)
      const mutations: Array<[string, string, boolean]> = [
        ['unrelated ticker', "document.querySelector('aside').firstChild.data = 'News 2'", true],
        [
          'ticker changes CSS context',
          "document.querySelector('aside').firstChild.data = ''",
          false,
        ],
        [
          'stylesheet text',
          "document.querySelector('style').firstChild.data = 'button{opacity:0}'",
          false,
        ],
        ['same-document URL', "history.pushState({}, '', '#new-state')", false],
        ['control label', "document.querySelector('button').firstChild.data = 'Accept'", false],
        [
          'consent meaning',
          "document.querySelector('p').firstChild.data = 'Reject enables tracking'",
          false,
        ],
        [
          'same-label replacement',
          "const el = document.querySelector('button'); el.replaceWith(el.cloneNode(true))",
          false,
        ],
        [
          'same-label region replacement',
          "const el = document.querySelector('[role=dialog]'); el.replaceWith(el.cloneNode(true))",
          false,
        ],
        [
          'target attribute',
          "document.querySelector('button').setAttribute('disabled', '')",
          false,
        ],
        ['ancestor attribute', "document.body.setAttribute('aria-hidden', 'true')", false],
        [
          'new overlay',
          "const el = document.createElement('div'); el.style = 'position:fixed;inset:0;z-index:999'; document.body.append(el)",
          false,
        ],
        [
          'existing overlay expands',
          "document.querySelector('aside').style = 'position:fixed;inset:0;z-index:999'",
          false,
        ],
        [
          'external name dependency',
          "document.querySelector('button').setAttribute('aria-describedby', 'elsewhere')",
          false,
        ],
        ['new frame', "document.body.append(document.createElement('iframe'))", false],
        [
          'new shadow root',
          "document.querySelector('aside').attachShadow({mode:'open'}).innerHTML = '<p>New</p>'",
          false,
        ],
        [
          'journal overflow',
          "for(let n=0;n<200;n++) document.querySelector('aside').firstChild.data = 'News '+n",
          false,
        ],
      ]
      // Counterexamples from independent review: explicitly expect TRUE to
      // document false-positive evidence. These are NOT allowed action cases.
      mutations.push(
        [
          'FALSE POSITIVE: outside consent context',
          "document.querySelector('#outside').firstChild.data = 'Reject permits optional uses'",
          true,
        ],
        [
          'FALSE POSITIVE: ancestor opacity',
          "document.querySelector('#opacity').firstChild.data = ''",
          true,
        ],
        [
          'FALSE POSITIVE: event handler',
          "document.querySelector('button').onclick = () => { window.accepts = 1 }",
          true,
        ],
        [
          'FALSE POSITIVE: closed shadow explanation',
          "document.querySelector('p').attachShadow({mode:'closed'}).innerHTML = 'Reject grants tracking'",
          true,
        ],
        [
          'FALSE POSITIVE: page realm tampering',
          `
          const nativeGet = Map.prototype.get;
          Map.prototype.get = function(key) {
            const value = nativeGet.call(this, key);
            if (value && value.baseline && value.target) {
              value.serial = Infinity;
              JSON.stringify = () => value.baseline;
            }
            return value;
          };
          document.querySelector('p').firstChild.data = 'Reject permits tracking';
        `,
          true,
        ],
      )
      for (const [name, mutation, allowed] of mutations) {
        const response = await run('navigate', { url: `${instrumented.origin}/target-prototype` })
        const text = response[0]?.type === 'text' ? response[0].text : ''
        const ref = /button "Reject" \[ref=(e\d+)\]/.exec(text)?.[1]
        expect(ref, name).toBeTruthy()
        const observed = await readDomStats(page)
        if (!observed) throw new Error('missing whole-document stats')
        const seal = await DialogTargetPrototype.capture(page, ref ?? '', observed)
        expect(seal, name).not.toBeNull()
        if (!seal) throw new Error('missing fixture seal')
        try {
          expect(await seal.unchanged(), name).toBe(true)
          await page.evaluate(mutation)
          expect(await seal.unchanged(), name).toBe(allowed)
          expect(await page.evaluate('window.rejects || 0'), name).toBe(0)
          if (name === 'unrelated ticker') {
            // Production remains strict even though the read-only prototype
            // recognizes this case. No seal is an action authorization.
            const refused = await run('click', {
              ref,
              observationId: /Observation: ([^ ]+)/.exec(text)?.[1],
            })
            expect(refused[0]).toMatchObject({
              type: 'text',
              text: expect.stringContaining('No action was dispatched'),
            })
            expect(await page.evaluate('window.rejects || 0')).toBe(0)
          }
        } finally {
          await seal.dispose()
        }
      }
      // New-document and pre-seal races cannot certify the old capture.
      const response = await run('navigate', { url: `${instrumented.origin}/target-prototype` })
      const text = response[0]?.type === 'text' ? response[0].text : ''
      const ref = /button "Reject" \[ref=(e\d+)\]/.exec(text)?.[1] ?? ''
      const observed = await readDomStats(page)
      if (!observed) throw new Error('missing whole-document stats')
      await page.evaluate("document.querySelector('p').firstChild.data = 'Changed before seal'")
      expect(await DialogTargetPrototype.capture(page, ref, observed)).toBeNull()
      const current = await readDomStats(page)
      if (!current) throw new Error('missing whole-document stats')
      const seal = await DialogTargetPrototype.capture(page, ref, current)
      if (!seal) throw new Error('missing current seal')
      try {
        await run('navigate', { url: `${instrumented.origin}/target-prototype` })
        expect(await seal.unchanged()).toBe(false)
      } finally {
        await seal.dispose()
      }
      const newStats = await readDomStats(page)
      if (!newStats) throw new Error('missing new document stats')
      await page.evaluate(
        "document.querySelector('button').setAttribute('aria-describedby', 'external')",
      )
      const dependentStats = await readDomStats(page)
      if (!dependentStats) throw new Error('missing dependent stats')
      expect(await DialogTargetPrototype.capture(page, ref, dependentStats)).toBeNull()
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('R12 semantic scopes exclude hidden roots and refuse missing or multiple matches', {
    timeout: 60_000,
  }, async () => {
    const agentId = 'semantic-cardinality'
    const paths = resolvePaths(join(scratch, agentId))
    const admission = { paths, agentId, teamId: 'fixture-team' }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    try {
      await invokeBrowserAction(agentId, 'snapshot', {}, config, admission, {
        daemonInstanceId: 'semantic-fixture-daemon',
      })
      const context = resources().browsers.get(agentId)?.handle?.context
      if (!context) throw new Error('missing fixture context')
      await context.route('**/cardinality', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<div role="dialog" hidden>Hidden</div><main>Article</main>',
        }),
      )
      await invokeBrowserAction(
        agentId,
        'navigate',
        { url: `${instrumented.origin}/cardinality` },
        config,
        admission,
        { daemonInstanceId: 'semantic-fixture-daemon' },
      )
      const capture = async () => {
        const out = await invokeBrowserAction(
          agentId,
          'snapshot',
          { scope: 'dialog' },
          config,
          admission,
          { daemonInstanceId: 'semantic-fixture-daemon' },
        )
        return out[0]?.type === 'text' ? out[0].text : ''
      }
      expect(await capture()).toContain('scope_absent')
      const page = await activePage(context)
      await page.evaluate(
        `document.body.insertAdjacentHTML('beforeend', '<dialog open>One</dialog><div role="dialog">Two</div>')`,
      )
      expect(await capture()).toContain('scope_ambiguous')
      await page.locator('dialog').evaluate((el) => el.remove())
      const single = await capture()
      expect(single).toContain('Two')
      expect(single).not.toContain('Hidden')
    } finally {
      await closeBrowserSession(agentId)
    }
  })

  test('cancelling active browser navigation retires the real owned process and marker', {
    timeout: 60_000,
  }, async () => {
    const paths = resolvePaths(join(scratch, 'cancel-active'))
    const agentId = 'cancel-active'
    const signal = new AbortController()
    const admission = { paths, agentId, teamId: 'cancel-team', signal: signal.signal }
    const config = {
      mode: 'headless' as const,
      executablePath: exePath,
      allowPrivate: true,
      idleMs: 60_000,
      maxSessions: 4,
    }
    const deps = { daemonInstanceId: 'cancel-fixture-daemon' }
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    try {
      await invokeBrowserAction(agentId, 'snapshot', {}, config, admission, deps)
      const entry = resources().browsers.get(agentId)
      if (!entry?.handle) throw new Error('fixture browser not running')
      const profileDir = entry.handle.profileDir
      await entry.handle.context.route('**/held-browser-action', async (route) => {
        started()
        await held
        await route.abort().catch(() => {})
      })
      const pending = invokeBrowserAction(
        agentId,
        'navigate',
        { url: `${instrumented.origin}/held-browser-action` },
        config,
        admission,
        deps,
      )
      // Observe immediately without creating a detached rejecting assertion. If navigation
      // fails before the held route, report that original failure rather than waiting for the
      // test deadline and emitting an unrelated unhandled cancellation assertion.
      const outcome = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      await Promise.race([
        requestStarted,
        outcome.then((result) => {
          throw new Error('navigation settled before reaching the controlled held route', {
            cause: result.ok ? undefined : result.error,
          })
        }),
      ])
      expect(entry.busy).toBe(1)
      signal.abort()
      const result = await outcome
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('cancelled navigation unexpectedly completed')
      expect(result.error).toBeInstanceOf(Error)
      expect((result.error as Error).message).toMatch(/cancelled/)
      release()
      await waitForNoOwnedProcesses(profileDir)
      expect(entry.busy).toBe(0)
      expect(resources().browsers.has(agentId)).toBe(false)
      expect(readOwnerMarker(paths.browserDir(agentId))).toBeNull()
      await expect(
        invokeBrowserAction(
          agentId,
          'navigate',
          { url: instrumented.origin },
          config,
          admission,
          deps,
        ),
      ).rejects.toThrow(/cancelled/)
    } finally {
      release()
      signal.abort()
      await closeBrowserSession(agentId)
    }
  })

  test('the production launcher: real marker/lock bookkeeping, guards, close, crash recovery', {
    timeout: 240_000,
  }, async () => {
    const paths: Paths = resolvePaths(join(scratch, 'prod-launch'))
    const slotDir = () => paths.browserDir('prod-agent')
    const profileDir = () => browserUserDataDir(slotDir())
    const readMarker = () => {
      const marker = readOwnerMarker(slotDir())
      return marker && !('error' in marker) ? marker : null
    }
    // Each "daemon generation" has its own instance identity; the crash phase
    // below relaunches as a NEW daemon, which is the actual restart path.
    const launchProd = async (daemonInstanceId: string) =>
      launchManagedBrowser({
        paths,
        agentId: 'prod-agent',
        teamId: 'prod-team',
        executablePath: exePath,
        headless: true,
        proxyUrl: await getSsrfProxy(),
        deps: { daemonInstanceId },
      })

    // Real launch on a clean slot: the marker is `running` and its pid is the
    // singleton-lock owner — a real owned process — and guards are live.
    const handle = await launchProd('daemon-a')
    const marker = readMarker()
    expect(marker).toMatchObject({
      phase: 'running',
      agentId: 'prod-agent',
      teamId: 'prod-team',
    })
    const pid = marker?.pid
    expect(pid).toBeTruthy()
    expect(ownedBrowserProcesses(profileDir()).some((p) => p.pid === pid)).toBe(true)
    const page = handle.context.pages()[0] ?? (await handle.context.newPage())
    expect(await page.evaluate('typeof RTCPeerConnection')).toBe('undefined')

    // Graceful close: the marker is removed only after exit is established.
    await handle.close()
    await waitForNoOwnedProcesses(profileDir())
    expect(readMarker()).toBeNull()
    expect(readSingletonLockPid(profileDir())).toBeNull()

    // Crash (SIGKILL the owned root): the marker stays as restart evidence,
    // and the next daemon (a NEW instance id, the actual restart path) reclaims
    // it only because the owner is positively absent.
    await launchProd('daemon-a')
    const root = ownedBrowserProcesses(profileDir()).find((p) => p.kind === 'root')
    expect(root).toBeTruthy()
    process.kill(root!.pid, 'SIGKILL')
    await waitForNoOwnedProcesses(profileDir())
    expect(readMarker()).toMatchObject({ phase: 'running' })
    const assessed = assessBrowserProfile(
      paths,
      { agentId: 'prod-agent', teamId: 'prod-team' },
      { daemonInstanceId: 'daemon-b' },
    )
    expect(assessed.state).toBe('ready')
    expect(assessed.staleOwner).toBe(true)

    // The next launch (as the new daemon) reclaims the stale marker and works.
    const relaunched = await launchProd('daemon-b')
    const rpage = relaunched.context.pages()[0] ?? (await relaunched.context.newPage())
    expect(await rpage.evaluate('typeof RTCPeerConnection')).toBe('undefined')
    expect(readMarker()).toMatchObject({ phase: 'running' })
    await relaunched.close()
    await waitForNoOwnedProcesses(profileDir())
    expect(readMarker()).toBeNull()
  })

  test.runIf(process.platform === 'darwin')(
    'actual non-GUI child selects headless, refuses headed, launches and retires managed browser',
    { timeout: 45_000 },
    async () => {
      const before = probeDarwinGuiSession()
      const home = join(scratch, 'actual-nongui-child')
      mkdirSync(home, { mode: 0o700 })
      const entry = fileURLToPath(new URL('../fixtures/browser-nongui.mjs', import.meta.url))
      const accountState = process.env.BAZILION_TEST_MACOS_ACCOUNT_STATE
      if (
        accountState &&
        (process.env.GITHUB_ACTIONS !== 'true' ||
          process.env.RUNNER_ENVIRONMENT !== 'github-hosted')
      )
        throw new Error(
          'privileged non-GUI provisioning requires the authorized disposable CI account',
        )
      const command = accountState ? '/usr/bin/sudo' : process.execPath
      const args = accountState
        ? [
            '-n',
            '--',
            '/usr/bin/env',
            '-i',
            'PATH=/usr/bin:/bin:/usr/sbin',
            `HOME=${home}`,
            'BAZILION_TEST_DISPOSABLE_MACOS=1',
            process.execPath,
            entry,
            '--create-session',
            String(process.getuid?.()),
            String(process.getgid?.()),
            exePath,
            home,
            accountState,
          ]
        : ['--import', 'tsx/esm', entry, exePath, home]
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          command,
          args,
          {
            timeout: 35_000,
            maxBuffer: 64 * 1024,
            env: { PATH: '/usr/bin:/bin:/usr/sbin', HOME: home, LANG: 'C', LC_ALL: 'C' },
          },
          (error, stdout, stderr) => {
            if (error)
              reject(new Error(`controlled non-GUI child failed: ${error.message}; ${stderr}`))
            else resolve(stdout)
          },
        )
      })
      expect(JSON.parse(stdout.trim())).toEqual({
        availability: 'unavailable',
        mode: 'headless',
        headedRefused: true,
        screenshot: true,
        closed: true,
        graphicAccess: false,
      })
      expect(probeDarwinGuiSession()).toBe(before)
    },
  )

  test.runIf(process.env.BAZILION_TEST_BROWSER_HEADED === '1')(
    'headed direct launch opens a local window without headless or pipe flags',
    { timeout: 30_000 },
    async () => {
      if (process.platform === 'darwin') expect(probeDarwinGuiSession()).toBe('available')
      const paths = resolvePaths(join(scratch, 'headed-launch'))
      const handle = await launchManagedBrowser({
        paths,
        agentId: 'headed-agent',
        teamId: 'headed-team',
        executablePath: exePath,
        headless: false,
        display: process.env.DISPLAY,
        xauthority: process.env.XAUTHORITY,
        waylandDisplay: process.env.WAYLAND_DISPLAY,
        xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
        proxyUrl: await getSsrfProxy(),
        deps: { daemonInstanceId: 'headed-daemon' },
      })
      try {
        const page = await activePage(handle.context)
        await page.setContent(
          '<title>Bazilion local browser test</title><h1>Bazilion: direct local browser + CDP</h1><p>Offline fixture. No public website requested.</p>',
        )
        const root = ownedBrowserProcesses(handle.profileDir).find((p) => p.kind === 'root')
        expect(root).toBeTruthy()
        expect(root?.argv.some((arg) => arg.startsWith('--headless'))).toBe(false)
        expect(root?.argv).not.toContain('--remote-debugging-pipe')
        expect(await page.evaluate('window.outerWidth > 0 && window.outerHeight > 0')).toBe(true)
        await sleep(2_000)
      } finally {
        await handle.close()
      }
      await waitForNoOwnedProcesses(handle.profileDir)
    },
  )

  test('teardown settles within bounds: browser close, process exit, proxy close', {
    timeout: 60_000,
  }, async () => {
    // Teardown must settle within a documented bound (D2), including with
    // lingering sockets. A stalled step fails with its label instead of an
    // opaque hook timeout — recorded as evidence for T05's proxy-close fix.
    const stalled: string[] = []
    const settles = async (p: Promise<unknown>, ms: number, label: string) => {
      const outcome = await Promise.race([
        p.then(
          () => null,
          () => 'rejected',
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('stalled'), ms)),
      ])
      if (outcome) stalled.push(`${label}:${outcome}`)
    }

    await settles(postureCtx!.close(), 15_000, 'posture context close')
    postureCtx = null
    await waitForNoOwnedProcesses(postureProfile)
    await settles(instrumented.close(), 15_000, 'instrumented origin close')
    await settles(closeSsrfProxy(), 15_000, 'ssrf proxy close')
    expect(stalled).toEqual([])
  })
})
