// Direct local Chromium ownership (BAZ-069). Spawn first; attach Playwright
// only to the loopback listener proven to belong to THIS child. Never discover
// or reconnect using a stale port file, personal browser, or remote endpoint.
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Browser, BrowserContext, CDPSession } from 'playwright'
import { getDarwinProcessInspector } from '../process/darwin.ts'
import { OwnedGroupAuthority } from './group-authority.ts'
import {
  installManagedGuards,
  type ManagedPostureInput,
  managedBrowserEnv,
  managedLaunchArgs,
} from './guards.ts'
import { probeProcessGroupPresence } from './profile.ts'

const execFileAsync = promisify(execFile)
const STARTUP_MS = 15_000
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface OwnedBrowserProcess {
  context: BrowserContext
  /** Must prove process exit, not merely disconnect the automation client. */
  close(): Promise<void>
}
export class BrowserProcessError extends Error {
  constructor(
    readonly reasonCode:
      | 'browser_start_failed'
      | 'browser_start_timeout'
      | 'browser_security_unavailable'
      | 'browser_recovery_required',
    message: string,
  ) {
    super(message)
    this.name = 'BrowserProcessError'
  }
}

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BrowserProcessError(
                'browser_start_timeout',
                'browser operation exceeded its deadline',
              ),
            ),
          Math.max(1, ms),
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Reserve a nonzero port, like OpenClaw. Closing the reservation creates a
 * race; listener ownership is checked before attachment, so a collision fails
 * closed instead of attaching to whichever process won. */
async function choosePort(timeoutMs: number): Promise<number> {
  const server = createServer()
  const controller = new AbortController()
  try {
    return await bounded(
      new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen({ port: 0, host: '127.0.0.1', signal: controller.signal }, () => {
          const address = server.address()
          server.close((error) => {
            if (error) reject(error)
            else if (!address || typeof address === 'string')
              reject(new Error('no local browser port'))
            else resolve(address.port)
          })
        })
      }),
      timeoutMs,
    )
  } finally {
    // A timed-out bind must not leave a late listener behind.
    controller.abort()
  }
}

/** No HTTP discovery or redirects. The fresh child's bounded stderr supplies
 * the opaque browser path, and only the expected loopback authority is valid. */
export function parseOwnedEndpoint(line: string, port: number): string | null {
  const match =
    /^DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[a-zA-Z0-9-]+)$/.exec(
      line.trim(),
    )
  return match && Number(match[2]) === port ? (match[1] ?? null) : null
}

/** A port file / HTTP version response alone does not prove ownership. */
export async function ownsLoopbackListener(pid: number, port: number): Promise<boolean> {
  try {
    if (process.platform === 'linux') {
      const sockets = new Set(
        readdirSync(`/proc/${pid}/fd`).flatMap((fd) => {
          try {
            return [readlinkSync(`/proc/${pid}/fd/${fd}`)]
          } catch {
            return []
          }
        }),
      )
      const rows = ['tcp', 'tcp6'].flatMap((name) =>
        readFileSync(`/proc/${pid}/net/${name}`, 'utf8').trim().split('\n').slice(1),
      )
      const listeners = rows
        .map((row) => row.trim().split(/\s+/))
        .filter(
          (fields) =>
            fields[3] === '0A' &&
            Number.parseInt(fields[1]?.split(':')[1] ?? '', 16) === port &&
            sockets.has(`socket:[${fields[9]}]`),
        )
      return (
        listeners.length > 0 && listeners.every((fields) => fields[1]?.split(':')[0] === '0100007F')
      )
    }
    if (process.platform === 'darwin') {
      const inspector = getDarwinProcessInspector()
      const before = inspector.member(pid)
      if (!before || before.state === 'Z') return false
      const { stdout } = await execFileAsync(
        '/usr/sbin/lsof',
        ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn'],
        { timeout: 1_000, maxBuffer: 16_384, env: { PATH: '/usr/bin:/bin:/usr/sbin' } },
      )
      const after = inspector.member(pid)
      if (
        !after ||
        after.state === 'Z' ||
        after.start !== before.start ||
        after.uid !== before.uid ||
        after.group !== before.group ||
        after.session !== before.session
      )
        return false
      const addresses = stdout.split('\n').filter((line) => line.startsWith('n'))
      return addresses.length > 0 && addresses.every((line) => line === `n127.0.0.1:${port}`)
    }
  } catch {
    /* Unreadable ownership is not authorization to attach. */
  }
  return false
}

/** Prevent automatic crash/session tab restore while retaining cookies and
 * storage. A fresh blank tab is the only page admitted before guards install. */
function prepareProfile(profileDir: string): void {
  for (const dir of [profileDir, join(profileDir, 'Default')]) {
    try {
      const stat = lstatSync(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('unsafe browser profile directory')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(dir, { mode: 0o700 })
    }
  }
  const path = join(profileDir, 'Default', 'Preferences')
  let prefs: Record<string, unknown> = {}
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
      throw new Error('unsafe browser preferences')
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      if (!fstatSync(fd).isFile()) throw new Error('unsafe browser preferences')
      const bytes = Buffer.alloc(4 * 1024 * 1024 + 1)
      const size = readSync(fd, bytes, 0, bytes.length, 0)
      if (size === bytes.length) throw new Error('oversized browser preferences')
      prefs = JSON.parse(bytes.subarray(0, size).toString('utf8'))
    } finally {
      closeSync(fd)
    }
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs))
      throw new Error('invalid browser preferences')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const record = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  prefs.session = { ...record(prefs.session), restore_on_startup: 5 }
  prefs.profile = { ...record(prefs.profile), exit_type: 'Normal', exited_cleanly: true }
  const tmp = `${path}.bazilion-${randomUUID()}`
  try {
    writeFileSync(tmp, JSON.stringify(prefs), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Only groups created by this live launcher are ever signalled. Disk markers
 * are restart evidence and are never fed into this registry. */
const liveGroups = new Set<OwnedGroupAuthority>()
function killOwnedGroups(): void {
  for (const authority of liveGroups) authority.signal('SIGKILL')
}
function onTerm(): void {
  if (process.listenerCount('SIGTERM') === 1) {
    killOwnedGroups()
    process.exit(143)
  }
}
function onInt(): void {
  if (process.listenerCount('SIGINT') === 1) {
    killOwnedGroups()
    process.exit(130)
  }
}
function registerGroup(authority: OwnedGroupAuthority): void {
  if (liveGroups.size === 0) {
    process.on('exit', killOwnedGroups)
    process.on('SIGTERM', onTerm)
    process.on('SIGINT', onInt)
  }
  liveGroups.add(authority)
}
function unregisterGroup(authority: OwnedGroupAuthority): void {
  authority.revoke()
  liveGroups.delete(authority)
  if (!liveGroups.size) {
    process.off('exit', killOwnedGroups)
    process.off('SIGTERM', onTerm)
    process.off('SIGINT', onInt)
  }
}

function groupAbsent(pid: number): boolean {
  return probeProcessGroupPresence(pid) === 'absent'
}

/** Default factory used by launch.ts; test injection is at this boundary, not
 * an alternate product path or an arbitrary-args operator setting. */
export async function startOwnedBrowser(
  input: ManagedPostureInput,
  onSpawn: (pid: number) => void,
  deps: {
    startupMs?: number
    /** Internal test seams; never operator/worker capabilities. */
    groupAuthority?: (pid: number) => OwnedGroupAuthority
    groupAbsent?: typeof groupAbsent
    installGuards?: typeof installManagedGuards
    /** Controlled fixture diagnostics only; never an operator/worker capability or default log. */
    observeStderr?: (chunk: string) => void
  } = {},
): Promise<OwnedBrowserProcess> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new BrowserProcessError(
      'browser_security_unavailable',
      'owned browser process verification is unsupported on this platform',
    )
  }
  if (process.platform === 'darwin') {
    try {
      getDarwinProcessInspector().assertReady()
    } catch {
      throw new BrowserProcessError(
        'browser_security_unavailable',
        'native process ownership unavailable',
      )
    }
  }
  const deadline = Date.now() + (deps.startupMs ?? STARTUP_MS)
  prepareProfile(input.profileDir)
  const port = await choosePort(deadline - Date.now())
  const child: ChildProcess = spawn(input.executablePath, managedLaunchArgs(input, port), {
    env: managedBrowserEnv({
      ...input,
      ...(input.headless
        ? {
            display: undefined,
            xauthority: undefined,
            waylandDisplay: undefined,
            xdgRuntimeDir: undefined,
          }
        : {}),
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  })
  let exited = false
  let spawnFailed = false
  child.once('exit', () => {
    exited = true
  })
  child.once('error', () => {
    spawnFailed = true
  })
  const pid = child.pid
  const authority = pid
    ? (deps.groupAuthority?.(pid) ?? new OwnedGroupAuthority(pid, undefined, undefined, child))
    : undefined
  const isGroupAbsent = deps.groupAbsent ?? groupAbsent
  let browser: Browser | undefined
  let cdp: CDPSession | undefined
  let closing: Promise<void> | undefined
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      if (!pid) {
        if (!spawnFailed) await sleep(10)
        if (!spawnFailed)
          throw new BrowserProcessError(
            'browser_recovery_required',
            'browser process ownership is unknown',
          )
        return
      }
      try {
        // Remember current descendants while a known member still anchors the
        // group, before graceful shutdown can retire the leader.
        authority?.refresh()
        // browser.close() on CDP only disconnects. Browser.close is the actual
        // graceful Chromium shutdown command. Its reply may race disconnection.
        if (cdp) await bounded(cdp.send('Browser.close'), 500).catch(() => {})
        const waitForExit = async (ms: number) => {
          const until = Date.now() + ms
          do {
            if (exited && isGroupAbsent(pid)) return true
            await sleep(50)
          } while (Date.now() < until)
          return false
        }
        let absent = await waitForExit(cdp ? 4_500 : 1)
        for (const [signal, ms] of [
          ['SIGTERM', 2_000],
          ['SIGKILL', 1_000],
        ] as const) {
          if (absent) break
          // Never signal after absence has already been established.
          if (!isGroupAbsent(pid)) authority?.signal(signal)
          absent = await waitForExit(ms)
        }
        if (!absent)
          throw new BrowserProcessError(
            'browser_recovery_required',
            'owned browser process exit could not be established',
          )
      } finally {
        // Recovery markers outlive an uncertain close; signalling authority
        // must NOT. A late exit / group-id reuse can never authorize a kill.
        if (authority) unregisterGroup(authority)
        await bounded(browser?.close() ?? Promise.resolve(), 500).catch(() => {})
      }
    })())
  // A manual window close or crash also retires remaining descendants. The
  // higher-level owner marker remains evidence until its handle is retired.
  child.once('exit', () => {
    void close().catch(() => {})
  })
  try {
    if (pid) {
      if (authority) registerGroup(authority)
      onSpawn(pid)
    }
    let pending = ''
    const endpoint = await bounded(
      new Promise<string>((resolve, reject) => {
        child.once('error', () => reject(new Error('browser spawn failed')))
        child.once('exit', () => reject(new Error('browser exited before attachment')))
        child.stderr?.on('data', (chunk: Buffer) => {
          deps.observeStderr?.(chunk.toString('utf8'))
          pending = (pending + chunk.toString('utf8')).slice(-16_384)
          const lines = pending.split('\n')
          pending = lines.pop() ?? ''
          for (const line of lines) {
            const endpoint = parseOwnedEndpoint(line, port)
            if (endpoint) resolve(endpoint)
          }
        })
      }),
      deadline - Date.now(),
    )
    if (!pid || exited || !authority?.ownsLeader() || !(await ownsLoopbackListener(pid, port))) {
      throw new BrowserProcessError(
        'browser_security_unavailable',
        'browser debugging listener ownership could not be verified',
      )
    }
    const { chromium } = await import('playwright')
    browser = await chromium.connectOverCDP(endpoint, {
      timeout: Math.max(1, deadline - Date.now()),
      isLocal: true,
    })
    if (exited || !authority?.ownsLeader() || !(await ownsLoopbackListener(pid, port))) {
      throw new BrowserProcessError(
        'browser_security_unavailable',
        'browser ownership changed during attachment',
      )
    }
    cdp = await bounded(browser.newBrowserCDPSession(), deadline - Date.now())
    // Attachment may apply default context overrides. Pin deny AFTER attach,
    // before any untrusted page is exposed. No download path is granted.
    await bounded(
      cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true }),
      deadline - Date.now(),
    )
    const context = browser.contexts()[0]
    if (!context) throw new Error('browser has no persistent default context')
    await bounded((deps.installGuards ?? installManagedGuards)(context), deadline - Date.now())
    authority?.refresh()
    return { context, close }
  } catch (error) {
    await close() // Uncertain cleanup overrides a start failure; never clear its marker.
    if (error instanceof BrowserProcessError) throw error
    throw new BrowserProcessError(
      'browser_start_failed',
      'local browser startup or CDP attachment failed',
    )
  }
}
