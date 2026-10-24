// Shared fixtures for the BAZ-069 managed-browser actual-browser lane
// (BAZILION_TEST_BROWSER=1, see test/lib/browser-managed.integration.test.ts).
//
// The launch posture itself lives in the production module
// `src/lib/browser/guards.ts` (T05) — this fixture imports it so the lane
// asserts the real controls rather than a parallel copy. Only test-specific
// instrumentation lives here: an instrumented loopback HTTP origin, a loopback
// UDP listener, the owned-process probe, and a thin launch helper.

import { createSocket } from 'node:dgram'
import { mkdirSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type BrowserContext, chromium } from 'playwright'
import { installManagedGuards, type ManagedPostureInput } from '../../src/lib/browser/guards.ts'
import { startOwnedBrowser } from '../../src/lib/browser/process.ts'
import { ownedDarwinBrowserProcesses } from './browser-managed-darwin.ts'

export type { ManagedPostureInput } from '../../src/lib/browser/guards.ts'
export {
  MANAGED_DENIAL_ARGS,
  MANAGED_INIT_SCRIPTS,
  managedLaunchArgs,
} from '../../src/lib/browser/guards.ts'

/**
 * Launch the managed adapter for the lane: the production pinned options and
 * guards, plus (for the control arm only) raw args. Test-only bookkeeping
 * (profile slots, owner markers) is T06's launcher, not this helper.
 */
export interface ManagedLaneInput extends ManagedPostureInput {
  /** Control arm only: strip the authored denials to record the exposure. */
  denialArgs?: readonly string[]
  /** Startup evidence only: runs after CDP attachment, before document guards. */
  beforeGuards?: (context: BrowserContext) => Promise<void>
}

export async function launchLaneContext(input: ManagedLaneInput): Promise<BrowserContext> {
  if (input.denialArgs !== undefined) {
    // Exposure control ONLY, not evidence for the product launch adapter.
    return chromium.launchPersistentContext(input.profileDir, {
      executablePath: input.executablePath,
      headless: input.headless,
      chromiumSandbox: true,
      args: [...input.denialArgs],
    })
  }
  mkdirSync(input.home, { recursive: true, mode: 0o700 })
  let diagnosticBytes = 0
  const diagnostic = (text: string) => {
    if (process.env.BAZILION_TEST_BROWSER_DIAGNOSTICS !== '1' || diagnosticBytes >= 64 * 1024)
      return
    const bounded = text
      .slice(0, 64 * 1024 - diagnosticBytes)
      .replace(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/g, '[private-cdp]')
    diagnosticBytes += bounded.length
    console.log('[controlled-browser-diagnostic]', bounded)
  }
  const owned = await startOwnedBrowser(input, () => {}, {
    observeStderr: diagnostic,
    installGuards: async (context) => {
      const observe = (page: import('playwright').Page) => {
        page.on('requestfailed', (request) =>
          diagnostic(`request failed: ${request.url()} ${request.failure()?.errorText}`),
        )
        page.on('console', (message) => diagnostic(`console: ${message.type()} ${message.text()}`))
      }
      if (process.env.BAZILION_TEST_BROWSER_DIAGNOSTICS === '1') {
        context.on('page', observe)
        for (const page of context.pages()) observe(page)
      }
      await input.beforeGuards?.(context)
      await installManagedGuards(context)
    },
  })
  // Test convenience: context.close must retire the child, not just disconnect.
  const ctx = owned.context
  ctx.close = () => owned.close()
  return ctx
}

// --- instrumented loopback HTTP fixture ---

export interface InstrumentedOrigin {
  origin: string
  /** Every request URL the fixture ever received (the zero-hit assertion). */
  hits: string[]
  swPage: string
  bigPage: string
  downloadPage: string
  close(): Promise<void>
}

const SW_PAGE_HTML = `<!doctype html><html><head><title>sw-probe</title></head><body>
<p>service worker probe</p>
<script>
navigator.serviceWorker.register('/sw.js', { scope: '/sw-scope/' }).then(
  () => { document.title = 'SW-RESOLVED' },
  (e) => { document.title = 'SW-REJECTED:' + e.name },
)
</script></body></html>`

const DOWNLOAD_PAGE_HTML = `<!doctype html><html><head><title>download-probe</title></head><body>
<p>download probe</p><a id="dl" href="/file.bin" download>download</a></body></html>`

function bigPageHtml(): string {
  const parts: string[] = []
  for (let i = 0; i < 2500; i++) {
    parts.push(
      `<p>paragraph ${i} of the bounded-capture probe with some ordinary filler text number ${i}</p>`,
    )
  }
  return `<!doctype html><html><head><title>big-probe</title></head><body><h1>bounded capture</h1>${parts.join('')}</body></html>`
}

/**
 * A loopback HTTP origin that records every request. Under the managed
 * posture (proxy with `<-loopback>`) nothing may reach it: private
 * destinations must hit **zero** instrumented targets.
 */
export async function createInstrumentedOrigin(): Promise<InstrumentedOrigin> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/sw.js') {
      res.setHeader('content-type', 'application/javascript')
      res.end(
        `self.addEventListener('install', () => self.skipWaiting());
         self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
         self.addEventListener('fetch', event => {
           event.respondWith((async () => {
             let result = 'network-blocked';
             try { const response = await fetch('/worker-private-fetch'); result = 'network-status:' + response.status } catch {}
             return new Response('<html><body>persisted-worker-active ' + result + ' p2p:' + typeof RTCPeerConnection + '</body></html>', { headers: { 'content-type': 'text/html' } });
           })());
         });`,
      )
      return
    }
    if (req.url === '/file.bin') {
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-disposition', 'attachment; filename="probe.bin"')
      res.end('probe-download-bytes')
      return
    }
    if (req.url === '/sw-page') {
      res.setHeader('content-type', 'text/html')
      res.end(SW_PAGE_HTML)
      return
    }
    if (req.url === '/big-page') {
      res.setHeader('content-type', 'text/html')
      res.end(bigPageHtml())
      return
    }
    if (req.url === '/download-page') {
      res.setHeader('content-type', 'text/html')
      res.end(DOWNLOAD_PAGE_HTML)
      return
    }
    res.setHeader('content-type', 'text/plain')
    res.end('instrumented origin')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    hits,
    swPage: `${origin}/sw-page`,
    bigPage: `${origin}/big-page`,
    downloadPage: `${origin}/download-page`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// --- instrumented loopback UDP listener ---

export interface UdpProbe {
  port: number
  /** Count of datagrams received (must stay 0 under the managed posture). */
  datagrams: number[]
  close(): Promise<void>
}

/** Binds a loopback UDP socket and records every datagram that arrives. */
export async function createUdpProbe(): Promise<UdpProbe> {
  const sock = createSocket('udp4')
  const datagrams: number[] = []
  sock.on('message', (msg) => datagrams.push(msg.length))
  sock.on('error', () => {})
  await new Promise<void>((resolve) => sock.bind(0, '127.0.0.1', resolve))
  const port = (sock.address() as AddressInfo).port
  return {
    port,
    datagrams,
    close: () => new Promise<void>((resolve) => sock.close(() => resolve())),
  }
}

// --- actual owned-process evidence (Linux / Darwin) ---

export interface OwnedBrowserProcess {
  pid: number
  exe: string
  /** NUL-split argv. NOTE: Chromium rewrites child cmdlines into a single
   *  synthetic string, so child entries carry the whole line in argv[0]. */
  argv: string[]
  /** The full cmdline as one string — reliable for child-process matching. */
  cmdline: string
  environ: string[]
  kind: 'root' | 'child'
}

/**
 * Find the browser processes owned by a launch, keyed on the exact profile
 * path in their argv — the narrow ownership probe the plan names (never broad
 * process-name matching). Darwin uses bounded public libproc/sysctl evidence, not ps text.
 */
export function ownedBrowserProcesses(profileDir: string): OwnedBrowserProcess[] {
  if (process.platform === 'darwin') return ownedDarwinBrowserProcesses(profileDir)
  const found: OwnedBrowserProcess[] = []
  let entries: string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    let argv: string[] = []
    try {
      argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    } catch {
      continue
    }
    if (!argv.some((a) => a.includes(profileDir))) continue
    let exe = ''
    try {
      exe = readlinkSync(`/proc/${pid}/exe`)
    } catch {
      // EACCES on restricted kernels: keep the process, drop the exe detail.
    }
    let environ: string[] = []
    try {
      environ = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean)
    } catch {
      // Not a descendant, or exited between scans.
    }
    const cmdline = argv.join(' ')
    found.push({
      pid,
      exe,
      argv,
      cmdline,
      environ,
      kind: cmdline.includes('--type=') ? 'child' : 'root',
    })
  }
  return found
}
