// Start an agent's browser the OpenClaw way: spawn the installed binary on the
// agent's persistent profile and attach Playwright over CDP, so the browser runs
// without Playwright's automation launch flags.

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, CDPSession } from 'playwright'

const STARTUP_MS = 15_000

export interface LaunchOptions {
  executablePath: string
  /** The agent's browser directory: `user-data/` is the profile, `home/` its HOME. */
  dir: string
  headless: boolean
  /** The SSRF proxy; omitted only when private-network access is allowed. */
  proxyUrl?: string
}

export interface LaunchedBrowser {
  context: BrowserContext
  /** False once the browser process has exited (a crash, a closed window). */
  readonly running: boolean
  /** Quit Chromium, then kill its process group if anything lingers. Never throws. */
  close(): Promise<void>
}

/** Removes WebRTC from every page: its UDP traffic could not go through the proxy. */
const NO_WEBRTC_SCRIPT = `for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
  Object.defineProperty(window, name, { configurable: false, get() { return undefined } })
}`

function launchArgs(opts: LaunchOptions): string[] {
  const wayland = !opts.headless && !process.env.DISPLAY && !!process.env.WAYLAND_DISPLAY
  return [
    // Chromium picks the port and prints the endpoint on stderr.
    '--remote-debugging-port=0',
    `--user-data-dir=${join(opts.dir, 'user-data')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-updater-scheduler',
    '--disable-features=Translate,MediaRouter',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    // Saved passwords stay in the profile, out of the desktop keyring.
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-dev-shm-usage',
    // The proxy carries TCP only: keep QUIC and WebRTC UDP from going around it.
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ...(opts.headless ? ['--headless=new', '--disable-gpu'] : []),
    ...(wayland ? ['--ozone-platform=wayland'] : []),
    ...(opts.proxyUrl
      ? [`--proxy-server=${opts.proxyUrl}`, '--proxy-bypass-list=<-loopback>']
      : ['--no-proxy-server']),
    'about:blank',
  ]
}

/** PATH, locale, the profile's own HOME and, for a visible window, display access. */
function browserEnv(opts: LaunchOptions): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(opts.dir, 'home'),
    LANG: 'C.UTF-8',
  }
  if (!opts.headless) {
    for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
      const value = process.env[key]
      if (value) env[key] = value
    }
  }
  return env
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is gone.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kill a browser that a daemon which died (SIGKILL, OOM) left running on the
 * profile in `dir` (the agent's browser directory, as in LaunchOptions).
 */
export async function killOrphanBrowser(dir: string): Promise<void> {
  const userDataDir = join(dir, 'user-data')
  let pid: number
  try {
    // Chromium's profile lock is a symlink to "<hostname>-<pid>".
    pid = Number(/-(\d+)$/.exec(readlinkSync(join(userDataDir, 'SingletonLock')))?.[1])
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    if (!argv.includes(`--user-data-dir=${userDataDir}`)) return
  } catch {
    return
  }
  signalGroup(pid, 'SIGKILL')
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Already gone with its group.
  }
  for (let i = 0; i < 40 && isAlive(pid); i++) await sleep(50)
}

/** Open with a blank tab instead of restoring the previous session's pages. */
function skipSessionRestore(userDataDir: string): void {
  const dir = join(userDataDir, 'Default')
  const file = join(dir, 'Preferences')
  let prefs: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      prefs = parsed as Record<string, unknown>
    }
  } catch {
    // A new profile has no preferences yet.
  }
  prefs.session = { ...(prefs.session as object), restore_on_startup: 5 }
  prefs.profile = { ...(prefs.profile as object), exit_type: 'Normal', exited_cleanly: true }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 })
}

// Browsers still running when the daemon process exits are killed by one hook.
const liveGroups = new Set<number>()
let exitHookInstalled = false

function trackGroup(pid: number): void {
  liveGroups.add(pid)
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => {
    for (const group of liveGroups) signalGroup(group, 'SIGKILL')
  })
}

export async function launchBrowser(opts: LaunchOptions): Promise<LaunchedBrowser> {
  const userDataDir = join(opts.dir, 'user-data')
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 })
  mkdirSync(join(opts.dir, 'home'), { recursive: true, mode: 0o700 })
  await killOrphanBrowser(opts.dir)
  skipSessionRestore(userDataDir)

  // Detached: the browser leads its own process group, helpers included.
  const child = spawn(opts.executablePath, launchArgs(opts), {
    env: browserEnv(opts),
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.on('error', () => {})
  const pid = child.pid
  if (pid) {
    trackGroup(pid)
    // Whenever the main process exits (a crash, a closed window, a quit), its
    // helpers go at once, while the group id is still theirs. The group is
    // never signalled again after this, so a reused pid is never hit.
    child.once('exit', () => {
      signalGroup(pid, 'SIGKILL')
      liveGroups.delete(pid)
    })
  }
  const exited = new Promise<boolean>((resolve) => child.once('exit', () => resolve(true)))
  const waitForExit = (ms: number) => Promise.race([exited, sleep(ms).then(() => false)])
  const running = () => child.exitCode === null && child.signalCode === null

  let browser: Browser | undefined
  let cdp: CDPSession | undefined
  let closing: Promise<void> | undefined
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      if (pid && running()) {
        // Browser.close is Chromium's own clean quit, which saves cookies;
        // disconnecting Playwright alone would leave the process running.
        cdp?.send('Browser.close').catch(() => {})
        if (!(await waitForExit(cdp ? 5_000 : 0))) {
          signalGroup(pid, 'SIGTERM')
          if (!(await waitForExit(2_000))) {
            signalGroup(pid, 'SIGKILL')
            await waitForExit(1_000)
          }
        }
      }
      if (browser) await Promise.race([browser.close().catch(() => {}), sleep(1_000)])
    })())

  let stderr = ''
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const fail = (message: string) => {
        clearTimeout(timer)
        reject(new Error(stderr.trim() ? `${message}:\n${stderr.trim()}` : message))
      }
      const timer = setTimeout(
        () => fail(`the browser did not start within ${STARTUP_MS / 1000}s`),
        STARTUP_MS,
      )
      child.once('error', (error) =>
        fail(`could not run ${opts.executablePath} (${error.message})`),
      )
      child.once('exit', (code, signal) =>
        fail(`the browser exited during startup (${signal ?? `exit code ${code}`})`),
      )
      let pending = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stderr = (stderr + text).slice(-2_000)
        const lines = (pending + text).slice(-16_384).split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const match =
            /^DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)$/.exec(
              line.trim(),
            )
          if (match?.[1]) {
            clearTimeout(timer)
            resolve(match[1])
          }
        }
      })
    })
    const { chromium } = await import('playwright')
    browser = await chromium.connectOverCDP(endpoint, { timeout: STARTUP_MS, isLocal: true })
    cdp = await browser.newBrowserCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' })
    const context = browser.contexts()[0]
    if (!context) throw new Error('the browser has no default context')
    context.setDefaultNavigationTimeout(30_000)
    context.setDefaultTimeout(10_000)
    await context.addInitScript(NO_WEBRTC_SCRIPT)
    // The first tab opened before the init script existed: give it a fresh document.
    await (context.pages()[0] ?? (await context.newPage())).goto('about:blank')
    return {
      context,
      close,
      get running() {
        return running()
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
