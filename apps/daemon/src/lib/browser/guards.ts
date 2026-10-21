// The pinned persistent-context controls for the managed browser adapter
// (BAZ-069 D3/T05), verified by the T01 actual-browser lane. This is the
// production counterpart of what that lane asserts; the test fixture imports
// it so the lane tests the real thing rather than a copy.
//
// Everything here is denial or allowlist, never stealth: no sandbox-disable,
// no extension, no fingerprint/UA patch, no extra capability. The browser
// keeps its native UA and is directly spawned, then CDP-attached. No
// automation-marker patching. The owned debugging listener is loopback-only.

import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import type { BrowserContext } from 'playwright'
import { DOM_SCAN_NODE_BOUND } from './observation.ts'

/**
 * Bazilion-authored denial args (D3). `--disable-quic`: an HTTP proxy cannot
 * carry UDP, so page loads must not open a direct QUIC/UDP path around the
 * pinned proxy. `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`:
 * constrains WebRTC candidate gathering (belt; the suspenders are the init
 * scripts below, because this flag is proven insufficient alone — a
 * page-injected remote candidate still drove direct STUN binding requests to
 * a loopback listener with and without it).
 *
 * (`--disable-dev-shm-usage` is Playwright's own Linux default, observed in
 * the child argv, and is not re-authored here.)
 */
export const MANAGED_DENIAL_ARGS = [
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
] as const

/**
 * Trusted internal instrumentation that removes the P2P API from every
 * document Bazilion's browser renders. `addInitScript` applies to every new
 * document in every frame (T01-verified for the main frame and dynamically
 * created iframes). WebRTC/P2P egress cannot honor the proxy — and launch-flag
 * policies are proven insufficient against page-injected remote candidates —
 * so the API is removed outright. Workers expose no P2P API, so documents are
 * the whole surface. A research browser has no peer-connection use case.
 */
export const MANAGED_INIT_SCRIPTS = [
  `for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    Object.defineProperty(window, name, {
      configurable: false,
      get() { return undefined },
    })
  }`,
  // Bounded-observation instrumentation (D5): a per-document identity and a
  // content-mutation generation, plus a bounded DOM-size estimate so an
  // oversized DOM is detected WITHOUT allocating an unbounded serialization
  // first. Trusted daemon-side instrumentation only; never model-supplied.
  `(() => {
    let generation = 0
    const docId = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    const observer = new MutationObserver(() => { generation++ })
    const observed = new WeakSet()
    const observeRoot = (root) => {
      if (observed.has(root)) return
      observer.observe(root, {
        subtree: true, childList: true, characterData: true, attributes: true,
      })
      observed.add(root)
      // Attaching a shadow root does not mutate the light DOM. Discovering
      // any new root invalidates an older observation before it can authorize
      // an action, including roots attached to already-existing hosts.
      generation++
    }
    const start = () => observeRoot(document.documentElement || document)
    if (document.documentElement) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
    Object.defineProperty(window, '__bazilion_obs', { value: Object.freeze({
      docId,
      stats(root = document.documentElement || document) {
        // document.open()/root replacement can retain the JS global while
        // replacing the observed light tree. Discover that change too.
        observeRoot(document.documentElement || document)
        let nodes = 0
        let chars = 0
        const walk = (node) => {
          if (nodes > ${DOM_SCAN_NODE_BOUND}) return
          nodes++
          if (node.nodeType === 3) chars += (node.textContent || '').length
          // Accessible names/URLs can be large even without text nodes.
          for (const attr of node.attributes || []) chars += attr.value.length
          // Playwright's accessibility tree traverses open shadow roots too.
          // Include them in BOTH freshness coverage and preflight accounting.
          if (node.shadowRoot) {
            observeRoot(node.shadowRoot)
            walk(node.shadowRoot)
          }
          for (const child of node.childNodes || []) {
            if (nodes > ${DOM_SCAN_NODE_BOUND}) break
            walk(child)
          }
        }
        walk(root)
        if (observer.takeRecords().length) generation++
        return { docId, generation, nodes, textChars: chars }
      },
    }), configurable: false, writable: false })
  })()`,
] as const

export interface ManagedEnvOptions {
  /** Managed HOME for the browser (inside the owned slot, never ambient). */
  home: string
  /** Explicit display access, only when a headed launch was selected. */
  display?: string
  xauthority?: string
  waylandDisplay?: string
  xdgRuntimeDir?: string
}

/**
 * The scrubbed allowlist child env. Copies **nothing** ambient: only PATH,
 * locale, the managed HOME and — when explicitly headed — display access.
 * Provider keys, proxy vars and the operator's browser home never reach the
 * browser process. (A distro wrapper executable may add its own CHROME_* vars;
 * observed and documented, it adds nothing else.)
 *
 * TMPDIR is deliberately NOT managed: Chromium's process singleton creates
 * `<TMPDIR>/org.chromium.Chromium.XXXX/SingletonSocket`, and a Unix socket
 * path is capped by `sockaddr_un.sun_path` (~104 bytes) — a TMPDIR deep inside
 * the owned slot makes Chromium SIGABRT at startup on deep paths
 * (`process_singleton_posix.cc` "Socket path too long"; T01-verified
 * 2026-09-25). The system temp dir keeps the ephemeral, per-instance socket
 * short; no ambient state is inherited by it. Persistent state stays in HOME
 * (inside the slot), which has no socket-path constraint.
 */
export function managedBrowserEnv(opts: ManagedEnvOptions): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: opts.home,
    LANG: 'C.UTF-8',
  }
  if (opts.display) env.DISPLAY = opts.display
  if (opts.xauthority) env.XAUTHORITY = opts.xauthority
  if (opts.waylandDisplay) env.WAYLAND_DISPLAY = opts.waylandDisplay
  if (opts.xdgRuntimeDir) env.XDG_RUNTIME_DIR = opts.xdgRuntimeDir
  // The managed HOME must exist before Chromium runs.
  mkdirSync(opts.home, { recursive: true, mode: 0o700 })
  const stat = lstatSync(opts.home)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe managed browser HOME')
  chmodSync(opts.home, 0o700)
  return env
}

export interface ManagedPostureInput {
  /** Validated executable path (T04). */
  executablePath: string
  /** The persistent on-disk profile directory (the owned slot's user-data). */
  profileDir: string
  /** Managed HOME, inside the owned slot. */
  home: string
  /** Explicitly resolved mode (T04); headed without a display must fail. */
  headless: boolean
  /** SSRF proxy URL. Omitted only for the labeled local-dev allowPrivate path. */
  proxyUrl?: string
  display?: string
  xauthority?: string
  waylandDisplay?: string
  xdgRuntimeDir?: string
}

/** Direct installed-browser launch, like OpenClaw; no Playwright launch defaults. */
export function managedLaunchArgs(input: ManagedPostureInput, port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${input.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-features=Translate,MediaRouter',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--password-store=basic',
    ...(process.platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ...(input.headless ? ['--headless=new', '--disable-gpu'] : []),
    // Prefer native Wayland when no X11 display was supplied.
    ...(!input.headless && !input.display && input.waylandDisplay
      ? ['--ozone-platform=wayland']
      : []),
    ...MANAGED_DENIAL_ARGS,
    ...(input.proxyUrl
      ? [`--proxy-server=${input.proxyUrl}`, '--proxy-bypass-list=<-loopback>']
      : ['--no-proxy-server']),
    'about:blank',
  ]
}

/** D2: existing navigation / interaction deadlines. */
export const NAVIGATION_DEADLINE_MS = 30_000
export const INTERACTION_DEADLINE_MS = 10_000

/**
 * Install the persistent-context controls onto a freshly launched context,
 * before anything can interact with it. The context's initial page predates
 * registration, so it is replaced with a fresh covered document — no realm
 * without the controls is ever handed to a caller.
 */
export async function installManagedGuards(context: BrowserContext): Promise<void> {
  context.setDefaultNavigationTimeout(NAVIGATION_DEADLINE_MS)
  context.setDefaultTimeout(INTERACTION_DEADLINE_MS)
  for (const script of MANAGED_INIT_SCRIPTS) {
    await context.addInitScript(script)
  }
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto('about:blank')
}
