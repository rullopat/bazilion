// Daemon-side managed browser session pool (BAZ-069 T07 / D4).
//
// One persistent managed browser per agent, launched by `launch.ts` on the
// agent's exclusively owned profile slot and held in the process-lifetime
// resource registry (`lib/resources.ts`). Sessions survive across turns —
// cookies, logins and open tabs carry over — and are retired by the idle
// reaper, on agent delete/cancel, at shutdown, or before a configuration
// change takes effect.
//
// Lifecycle (D4): `stopped → starting → running → stopping → stopped`. An
// unproven retirement or an unreconciled restart marker puts the slot in
// `recovery_required`; every further admission is refused until an operator
// resets it. Transitions are serialized per agent (a per-agent queue), so no
// launch overlaps a retiring profile. A stopping slot counts toward capacity
// until retirement is proved; when the pool is full and every session is
// busy, admission is refused rather than killing in-flight work.
//
// The worker's `browser_*` tools never touch Playwright directly: they proxy
// each action over IPC (`browserInvoke`) to `createBrowserHost`, which calls
// `invokeBrowserAction` here. Perception is accessibility-tree-first
// (`browser_snapshot` returns the AI aria snapshot with `[ref=eN]` refs);
// `browser_take_screenshot` is the secondary, vision-only escape hatch.

import { existsSync } from 'node:fs'
import type { BrowserReasonCode, BrowserSelection, BrowserStatus } from '@bazilion/api-types'
import { BROWSER_SNAPSHOT_SCOPES, type BrowserSnapshotScope } from '@bazilion/api-types'
import type { BrowserContext, ConsoleMessage, Page, Request } from 'playwright'
import type { Paths } from '../../core/index.ts'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import { ensureResourceReaper, resources } from '../resources.ts'
import {
  readCachedBrowserVersion,
  resolveBrowserExecutable,
  resolveBrowserMode,
} from './executable.ts'
import type { ManagedBrowserHandle } from './launch.ts'
import { launchManagedBrowser, ManagedLaunchError } from './launch.ts'
import {
  assertScreenshotWithinBound,
  boundText,
  type FormattedObservation,
  ObservationExpiredError,
  SessionObservations,
} from './observation.ts'
import { removeBrowserProfile } from './profile.ts'
import { getSsrfProxy } from './proxy.ts'
import { browserBlockReason } from './ssrf.ts'

const CONSOLE_CAP = 100
const NETWORK_CAP = 100
/** D2: tabs per agent. */
const MAX_TABS = 8

export interface BrowserConfig {
  /** Three-way operator preference: explicit headed/headless or auto. */
  mode?: 'auto' | 'headed' | 'headless'
  /** Operator-configured absolute browser path; absent means discover. */
  executablePath?: string
  allowPrivate: boolean
  idleMs: number
  maxSessions: number
}

/**
 * Daemon-owned admission inputs for browser work. The canonical Agent id is
 * resolved by the caller (the turn host) — never taken from worker arguments —
 * and the Team id is the *admitted* Team, so a profile can never be claimed
 * for a different Team than the turn was admitted into.
 */
export interface BrowserAdmission {
  paths: Paths
  /** The admitted turn's canonical Agent id — the pool key (T09). */
  agentId: string
  teamId: string
  /** The admitted turn's cancellation signal; an aborted turn may not drive the browser. */
  signal?: AbortSignal
  proxyUrl?: string
}

/** Every action `invokeBrowserAction` accepts (validated before pool access). */
export const BROWSER_ACTIONS: ReadonlySet<string> = new Set([
  'navigate',
  'snapshot',
  'click',
  'type',
  'hover',
  'select',
  'fill_form',
  'press_key',
  'go_back',
  'tabs',
  'take_screenshot',
  'console',
  'network',
])

export class PoolError extends Error {
  readonly reasonCode: BrowserReasonCode
  constructor(reasonCode: BrowserReasonCode, message: string) {
    super(boundText(message))
    this.name = 'PoolError'
    this.reasonCode = reasonCode
  }
}

interface ConsoleRecord {
  type: string
  text: string
}
interface NetworkRecord {
  method: string
  url: string
  status: number | null
}

/** One agent's pool slot in any of the D4 states. */
export interface ManagedBrowserEntry {
  agentId: string
  state: 'starting' | 'running' | 'stopping' | 'recovery_required'
  handle: ManagedBrowserHandle | null
  /** Fingerprint of the frozen posture this session was launched under. */
  posture: string
  lastUsedAt: number
  idleMs: number
  /** In-flight browser actions; reaping/eviction never touch a busy session. */
  busy: number
  failure: { reasonCode: BrowserReasonCode; detail: string } | null
  /** Bounded graceful retirement; removes the entry when settled. */
  close(force?: boolean): Promise<void>
}

/** Everything needed to dispatch actions on a running session. */
interface RunningSession {
  context: BrowserContext
  obs: SessionObservations
  console: ConsoleRecord[]
  network: NetworkRecord[]
}

export interface PoolDeps {
  /** Injectable launcher for lifecycle tests; defaults to the T06 launcher. */
  launch?: typeof launchManagedBrowser
  /** Forwarded to the launcher (tests inject an identity when daemon liveness is not acquired). */
  daemonInstanceId?: string
}

function postureFingerprint(config: BrowserConfig): string {
  return `${config.mode ?? 'auto'}|${config.executablePath ?? ''}|${config.allowPrivate}`
}

/** Per-agent transition queue: launches and retirements never overlap. */
const agentLocks = new Map<string, Promise<unknown>>()
function withLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const previous = agentLocks.get(agentId) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  agentLocks.set(
    agentId,
    next.catch(() => {}),
  )
  return next
}

// Separate from admission/retirement: cancellation must not wait for a stuck
// Playwright call. A retired entry's queue cannot authorize its replacement.
const actionLocks = new WeakMap<ManagedBrowserEntry, Promise<unknown>>()
function withActionLock<T>(entry: ManagedBrowserEntry, fn: () => Promise<T>): Promise<T> {
  const previous = actionLocks.get(entry) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  actionLocks.set(
    entry,
    next.catch(() => {}),
  )
  return next
}

/** Wake admitted callers on retirement even if a predecessor never settles. */
const retirementSignals = new WeakMap<
  ManagedBrowserEntry,
  { promise: Promise<never>; reject: (error: Error) => void }
>()
function retirementSignal(entry: ManagedBrowserEntry): Promise<never> {
  let signal = retirementSignals.get(entry)
  if (!signal) {
    let reject!: (error: Error) => void
    const promise = new Promise<never>((_, rejectPromise) => {
      reject = rejectPromise
    })
    void promise.catch(() => {})
    signal = { promise, reject }
    retirementSignals.set(entry, signal)
    if (entry.state !== 'running') {
      reject(new PoolError('browser_busy', 'browser session retired; effects may be uncertain'))
    }
  }
  return signal.promise
}

function activePage(entry: ManagedBrowserEntry): Page {
  const session = runningSession(entry)
  const activeTabId = session.obs.getActiveTab()
  const pages = session.context.pages().filter((p) => !p.isClosed())
  if (pages.length === 0) {
    session.obs.invalidate()
    throw new PoolError('browser_busy', 'browser has no open pages')
  }
  const active = activeTabId ? session.obs.pageForTab(pages, activeTabId) : null
  if (active) return active
  // A user or site may close the selected tab outside browser_tabs. Resolve
  // the fallback through the same invalidating transition as explicit select.
  const fallback = pages[0] as Page
  session.obs.setActiveTab(session.obs.registerTab(fallback))
  return fallback
}

// Active-tab index per agent (session-local, positional until T08's stable ids).
const sessionActiveIndex = new Map<string, number>()

// Per-agent session bookkeeping that lives outside the registry entry.
const sessionState = new Map<string, RunningSession>()

function runningSession(entry: ManagedBrowserEntry): RunningSession {
  const session = sessionState.get(entry.agentId)
  if (!session) throw new PoolError('browser_busy', 'browser session is not running')
  return session
}

interface ResolvedBrowserPosture {
  executablePath: string
  headless: boolean
  display?: string
  xauthority?: string
  waylandDisplay?: string
  xdgRuntimeDir?: string
}

/** Resolve the launch posture (executable + mode) from config; throws PoolError. */
function resolvePosture(config: BrowserConfig): ResolvedBrowserPosture {
  const executable = resolveBrowserExecutable(config.executablePath)
  if (!executable.ok || !executable.candidate) {
    throw new PoolError(
      executable.reasonCode ?? 'browser_not_found',
      executable.remedy ?? 'no supported browser is available',
    )
  }
  const mode = resolveBrowserMode(config.mode ?? 'auto')
  if (!mode.ok || !mode.mode) {
    throw new PoolError(
      mode.reasonCode ?? 'browser_display_unavailable',
      mode.remedy ?? 'the browser mode could not be resolved',
    )
  }
  const headed = mode.mode === 'headed'
  return {
    executablePath: executable.candidate.path,
    headless: !headed,
    ...(headed && process.env.DISPLAY ? { display: process.env.DISPLAY } : {}),
    ...(headed && process.env.XAUTHORITY ? { xauthority: process.env.XAUTHORITY } : {}),
    ...(headed && process.env.WAYLAND_DISPLAY
      ? { waylandDisplay: process.env.WAYLAND_DISPLAY }
      : {}),
    ...(headed && process.env.WAYLAND_DISPLAY && process.env.XDG_RUNTIME_DIR
      ? { xdgRuntimeDir: process.env.XDG_RUNTIME_DIR }
      : {}),
  }
}

function countHeldSlots(): number {
  // Unknown retirement may still own a live process. Recovery entries reserve
  // capacity too, until absence/recovery is positively established.
  return resources().browsers.size
}

const retirements = new WeakMap<ManagedBrowserEntry, Promise<void>>()

/** Retirement is idempotent, including when cancellation and shutdown race. */
function retireEntry(entry: ManagedBrowserEntry): Promise<void> {
  const pending = retirements.get(entry)
  if (pending) return pending
  const retiring = finishRetirement(entry)
  retirements.set(entry, retiring)
  return retiring
}

/** Retire one entry gracefully and remove it from the registry when settled. */
async function finishRetirement(entry: ManagedBrowserEntry): Promise<void> {
  if (entry.state === 'recovery_required') return
  const handle = entry.handle
  entry.state = 'stopping'
  retirementSignals
    .get(entry)
    ?.reject(new PoolError('browser_busy', 'browser session retired; effects may be uncertain'))
  entry.handle = null
  sessionState.delete(entry.agentId)
  sessionActiveIndex.delete(entry.agentId)
  try {
    if (handle) await handle.close()
  } catch (error) {
    // Unproven retirement: keep the slot refused rather than reclassifying it
    // as stopped — retirement errors are never swallowed.
    entry.state = 'recovery_required'
    entry.failure = {
      reasonCode: 'browser_recovery_required',
      detail: firstLine(error),
    }
    return
  }
  const registry = resources().browsers
  if (registry.get(entry.agentId) === entry) registry.delete(entry.agentId)
}

function firstLine(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? String(error)) : String(error)
}

function assertNotCancelled(admission: BrowserAdmission | undefined): void {
  if (admission?.signal?.aborted) {
    throw new Error(
      'browser: the turn was cancelled; no further actions are allowed (in-flight effects may be uncertain)',
    )
  }
}

/**
 * Admission (serialized per agent): returns a running entry, launching one on
 * first use. At capacity, the least-recently-used idle session is retired
 * first; when every session is busy, admission is refused.
 */
async function admitEntry(
  agentId: string,
  config: BrowserConfig,
  admission: BrowserAdmission | undefined,
  deps: PoolDeps | undefined,
): Promise<ManagedBrowserEntry> {
  return withLock(agentId, async () => {
    assertNotCancelled(admission)
    const registry = resources().browsers
    const existing = registry.get(agentId)
    if (existing) {
      if (existing.state === 'recovery_required') {
        throw new PoolError(
          'browser_recovery_required',
          existing.failure?.detail ??
            'this agent browser needs operator recovery before it can start again',
        )
      }
      if (existing.state === 'running' && existing.posture === postureFingerprint(config)) {
        existing.lastUsedAt = Date.now()
        existing.busy++
        return existing
      }
      if (existing.state !== 'running' || existing.busy > 0) {
        throw new PoolError('browser_busy', 'the browser is busy or retiring')
      }
      // A configuration change cannot retire in-flight work or overwrite a
      // recovery marker after an unsuccessful close.
      await retireEntry(existing)
      assertNotCancelled(admission)
      if (registry.get(agentId) === existing) {
        throw new PoolError('browser_recovery_required', 'browser retirement is uncertain')
      }
    }

    if (!admission) {
      throw new PoolError('browser_start_failed', 'browser admission inputs are unavailable')
    }
    if (countHeldSlots() >= config.maxSessions) {
      // Busy-aware eviction: only an idle running session may be retired.
      let candidate: ManagedBrowserEntry | null = null
      for (const entry of registry.values()) {
        if (entry.state !== 'running' || entry.busy > 0) continue
        if (!candidate || entry.lastUsedAt < candidate.lastUsedAt) candidate = entry
      }
      if (!candidate) {
        throw new PoolError(
          'browser_capacity_reached',
          `browser pool is at capacity (${config.maxSessions}) with every session busy`,
        )
      }
      // Selecting and marking stopping happen without yielding, so a queued
      // admission cannot acquire the candidate between the busy check and close.
      await retireEntry(candidate)
      assertNotCancelled(admission)
    }
    // Another agent may have reserved capacity while retirement was pending.
    // Reserve this starting entry synchronously only after rechecking.
    if (countHeldSlots() >= config.maxSessions) {
      throw new PoolError('browser_capacity_reached', 'browser pool is at capacity')
    }

    const posture = postureFingerprint(config)
    const entry: ManagedBrowserEntry = {
      agentId,
      state: 'starting',
      handle: null,
      posture,
      lastUsedAt: Date.now(),
      idleMs: config.idleMs,
      busy: 0,
      failure: null,
      close: (force = false) =>
        withLock(agentId, async () => {
          if (!force && entry.busy > 0) {
            throw new PoolError('browser_busy', 'the browser has in-flight actions')
          }
          await retireEntry(entry)
        }),
    }
    registry.set(agentId, entry)
    try {
      const { executablePath, headless, display, xauthority, waylandDisplay, xdgRuntimeDir } =
        resolvePosture(config)
      const proxyUrl = config.allowPrivate
        ? undefined
        : (admission.proxyUrl ?? (await getSsrfProxy()))
      assertNotCancelled(admission)
      const handle = await (deps?.launch ?? launchManagedBrowser)({
        paths: admission.paths,
        agentId,
        teamId: admission.teamId,
        executablePath,
        headless,
        proxyUrl,
        display,
        xauthority,
        waylandDisplay,
        xdgRuntimeDir,
        deps: deps?.daemonInstanceId ? { daemonInstanceId: deps.daemonInstanceId } : undefined,
      })
      entry.handle = handle
      // Startup is bounded by the launcher. If cancellation happened during
      // that await, close the newly owned handle without dispatching any action.
      assertNotCancelled(admission)
      entry.state = 'running'
      const session: RunningSession = {
        context: handle.context,
        obs: new SessionObservations(agentId),
        console: [],
        network: [],
      }
      // Stable session-local tab ids: existing pages and every future popup /
      // browser-created tab (D5) register as they appear.
      session.obs.registerPages(handle.context.pages())
      handle.context.on('page', (page) => {
        session.obs.registerTab(page)
        session.obs.invalidate()
      })
      sessionState.set(agentId, session)
      // Console/network observation is session-scoped bookkeeping.
      handle.context.on('console', (msg: ConsoleMessage) => {
        session.console.push({ type: msg.type(), text: msg.text() })
        if (session.console.length > CONSOLE_CAP) session.console.shift()
      })
      handle.context.on('request', (req: Request) => {
        session.network.push({ method: req.method(), url: req.url(), status: null })
        if (session.network.length > NETWORK_CAP) session.network.shift()
      })
      handle.context.on('response', (res) => {
        const rec = session.network.find((r) => r.url === res.url() && r.status === null)
        if (rec) rec.status = res.status()
      })
      ensureResourceReaper()
      // Held inside the admission lock: a queued retirement can never slip
      // between admission and the action's dispatch.
      entry.busy++
      return entry
    } catch (error) {
      if (entry.handle) await retireEntry(entry)
      const reasonCode =
        entry.state === 'recovery_required'
          ? 'browser_recovery_required'
          : error instanceof ManagedLaunchError
            ? error.reasonCode
            : ('browser_start_failed' as BrowserReasonCode)
      entry.failure = { reasonCode, detail: firstLine(error) }
      if (reasonCode === 'browser_recovery_required') {
        // Uncertain cleanup: keep the slot refused until an operator resets it.
        entry.state = 'recovery_required'
        entry.handle = null
        sessionState.delete(agentId)
      } else {
        // Proven cleanup: back to stopped; the next admission may retry.
        if (registry.get(agentId) === entry) registry.delete(agentId)
        sessionState.delete(agentId)
      }
      if (reasonCode !== 'browser_recovery_required') assertNotCancelled(admission)
      throw new PoolError(reasonCode, entry.failure.detail)
    }
  })
}

/** Close and retire an agent's browser session (cancel / delete / shutdown). */
export async function closeBrowserSession(agentId: string): Promise<void> {
  await withLock(agentId, async () => {
    const entry = resources().browsers.get(agentId)
    if (!entry) return
    if (entry.busy > 0) {
      throw new PoolError(
        'browser_busy',
        'the browser has in-flight actions; wait for the current turn to settle',
      )
    }
    await retireEntry(entry)
    // A failed retirement is never a silent no-op: lifecycle callers (delete,
    // archive, transfer) must learn the browser may still be alive.
    if (entry.state === 'recovery_required') {
      throw new PoolError(
        'browser_recovery_required',
        entry.failure?.detail ??
          'browser retirement could not be proven; operator recovery is required first',
      )
    }
  })
}

/**
 * Retire the session (if any) and remove the agent's profile slot — the
 * delete/transfer path (D6). Atomic under the per-agent lock, so no admission
 * can interleave between close and removal. Refuses when retirement cannot be
 * proven (the browser may still be alive) or the slot's ownership is unknown;
 * unresolved cleanup blocks the transition rather than leaking state.
 */
export async function clearBrowserProfile(
  agentId: string,
  paths: Paths,
  teamId: string,
): Promise<void> {
  await withLock(agentId, async () => {
    const entry = resources().browsers.get(agentId)
    if (entry) {
      if (entry.busy > 0) {
        throw new PoolError(
          'browser_busy',
          'the browser has in-flight actions; wait for the current turn to settle',
        )
      }
      await retireEntry(entry)
      if (entry.state === 'recovery_required') {
        throw new PoolError(
          'browser_recovery_required',
          entry.failure?.detail ??
            'the browser session could not be retired; profile removal is refused while the browser may be alive',
        )
      }
    }
    // Crash safety: refuses slots with unknown ownership or a live owned
    // process; tolerates absent slots and positively-absent stale owners.
    removeBrowserProfile(paths, { agentId, teamId })
  })
}

/** Idle reaping: never touches a busy session (D4). Called by the resource reaper. */
export function reapIdleBrowserSessions(now: number = Date.now()): void {
  for (const entry of resources().browsers.values()) {
    if (entry.busy > 0 || entry.state === 'recovery_required') continue
    if (entry.idleMs > 0 && entry.lastUsedAt + entry.idleMs <= now) {
      void entry.close().catch(() => {})
    }
  }
}

function text(s: string): ToolResultPart[] {
  return [{ type: 'text', text: boundText(s) }]
}

/** No page has been navigated yet (fresh session / after a daemon restart). */
function isBlank(page: Page): boolean {
  const u = page.url()
  return !u || u === 'about:blank'
}

const NO_PAGE_HINT =
  'No page is loaded yet — the browser is on about:blank (a fresh session). Call browser_navigate with a URL first, then retry.'

/**
 * Run a ref-targeted interaction and return a fresh bounded observation.
 *
 * An action timeout (or any failure) can land AFTER the effect took hold —
 * clicks submit forms, and a network hiccup does not un-submit them. The old
 * "the page was NOT changed by this call" claim was false in exactly the
 * cases that matter, so it is gone: report the uncertain effect, re-observe,
 * and never replay the action automatically (D5).
 */
async function actOnRef(
  entry: ManagedBrowserEntry,
  ref: string,
  observationId: unknown,
  capture: () => Promise<FormattedObservation>,
  fn: () => Promise<unknown>,
): Promise<ToolResultPart[]> {
  const session = runningSession(entry)
  let dispatched = false
  try {
    session.obs.requireCurrentObservation(observationId)
    await session.obs.assertFresh(activePage(entry))
    // Another action can replace the observation while freshness is awaited.
    session.obs.requireCurrentObservation(observationId)
    // Consume the observation before handing control to Playwright. A second
    // call with its id cannot dispatch while this action is in flight.
    session.obs.invalidate()
    dispatched = true
    await fn()
  } catch (err) {
    // Even if the page's generation did not change, a failed dispatched action
    // may have taken effect. Never let its old observation authorize a retry.
    if (dispatched) session.obs.invalidate()
    const expired = err instanceof ObservationExpiredError
    const first = boundText(firstLine(err), 512)
    const shownRef = boundText(ref, 256)
    const explanation =
      expired && !dispatched
        ? 'No action was dispatched: that observation is stale. Re-observe the page and use a current ref; address any newly visible blocker before another attempt.'
        : 'The action may or may not have taken effect (timeouts can land after an effect). Re-observe the page and verify the result before deciding whether to repeat it — never replay a submission blindly.'
    try {
      const fresh = await capture()
      return text(
        boundText(
          `Could not act on ref "${shownRef}": ${first}\n\n${explanation}\n\nFresh observation:\n\n${fresh.text}`,
        ),
      )
    } catch {
      return text(
        boundText(
          `Could not act on ref "${shownRef}": ${first}\n\n${explanation}\n\n(A fresh observation was not possible — the tab may have closed or navigated. Use browser_tabs to list tabs or browser_navigate to recover.)`,
        ),
      )
    }
  }
  session.obs.invalidate() // a mutating action invalidates previous cursors
  try {
    return text((await capture()).text)
  } catch (error) {
    return text(
      boundText(
        `The action was dispatched, but its post-action observation failed: ${firstLine(error)}\n\n` +
          'Its effect is unverified. Do not replay the action blindly. Take a fresh browser_snapshot or use browser_tabs to inspect the current destination before deciding what to do next.',
      ),
    )
  }
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v)
    throw new PoolError('browser_busy', `browser action: "${key}" must be a non-empty string`)
  return v
}

/** Never interpolate a worker-controlled selector into an aria-ref locator. */
function elementRef(value: unknown): string {
  if (typeof value !== 'string' || !/^e\d{1,9}$/.test(value)) {
    throw new PoolError('browser_busy', 'browser action: ref must be an element ref (e.g. e5)')
  }
  return value
}

function tabRef(value: unknown): string {
  if (typeof value !== 'string' || !/^tab-\d{1,9}$/.test(value)) {
    throw new PoolError('browser_busy', 'browser action: tabId must be a listed tab id')
  }
  return value
}

/**
 * Execute one browser action against an agent's managed session and return
 * the result as multimodal tool output. Called daemon-side by
 * `createBrowserHost`. `admission` carries the daemon-resolved canonical
 * Agent/Team binding; a session is never launched or revived without it.
 */
/** Static operator-safe diagnostics; never echo child stderr or filesystem paths. */
export function safeBrowserRemedy(reasonCode: BrowserReasonCode): string {
  switch (reasonCode) {
    case 'browser_recovery_required':
      return 'Browser ownership or shutdown could not be confirmed. The profile was retained; reconcile ownership before retrying.'
    case 'browser_start_failed':
    case 'browser_start_timeout':
      return 'The managed browser could not start. Check browser installation and daemon logs.'
    case 'browser_busy':
      return 'The browser has in-flight work. Wait for the current turn to settle, then retry.'
    case 'browser_capacity_reached':
      return 'The managed browser session limit is currently reached. Close an idle session or retry later.'
    case 'browser_not_found':
      return 'Install a supported browser or configure its executable in Browser settings.'
    case 'browser_invalid_executable':
      return 'The configured browser executable is unavailable. Correct or clear the executable setting.'
    case 'browser_display_unavailable':
      return 'The selected headed mode has no available display. Configure headless mode or start a desktop session.'
    case 'browser_incompatible':
      return 'The selected browser is incompatible with the managed browser adapter.'
    case 'browser_disabled':
      return 'Browser tools are disabled in service configuration.'
    case 'browser_security_unavailable':
      return 'Required browser security controls could not be established; browser startup was refused.'
    case 'browser_observation_expired':
      return 'The page changed after the observation. Take a fresh browser snapshot before acting.'
  }
}

/**
 * Read-only status for one Agent's managed browser (T09). Reports cached
 * observations and filesystem/config resolution; it never spawns a browser,
 * probes a version or unlocks a profile — safe to call from any context.
 */
export function browserStatusFor(
  agentId: string,
  config: BrowserConfig,
  admission: BrowserAdmission | undefined,
  enabled = true,
): BrowserStatus {
  const entry = resources().browsers.get(agentId)
  const exe = resolveBrowserExecutable(config.executablePath)
  const mode = resolveBrowserMode(config.mode ?? 'auto')
  const candidate = exe.ok ? exe.candidate : undefined
  const resolvedMode = mode.ok ? mode.mode : undefined
  let selected: BrowserSelection | undefined
  if (candidate && resolvedMode) {
    selected = {
      name: candidate.name,
      source: candidate.source,
      mode: resolvedMode,
    }
    // Cached observation only — a status read never probes the binary.
    const cached = readCachedBrowserVersion(candidate.path)
    if (cached) selected.version = cached.version
  }
  const resolved = candidate != null && resolvedMode != null
  const status: BrowserStatus = {
    agentId,
    enabled,
    availability: enabled ? (resolved ? 'configured' : 'unavailable') : 'disabled',
    state: entry?.state ?? 'stopped',
    profilePresent: admission ? existsSync(admission.paths.browserDir(agentId)) : false,
  }
  if (selected) status.selectedBrowser = selected
  // A live failure classification wins over config-resolution facts. The
  // live failure's detail is the operator-facing remedy — SANITIZED: launch
  // failures can embed raw child stderr with profile/home paths; a status
  // response never carries those (T13).
  const live = entry?.failure
  const reason = live
    ? {
        reasonCode: live.reasonCode,
        // Never forward launch/child stderr through the wire. The local detail
        // remains daemon-only; status exposes a bounded, static remedy.
        remedy: safeBrowserRemedy(live.reasonCode),
      }
    : resolved
      ? null
      : {
          reasonCode: (exe.reasonCode ?? mode.reasonCode) as BrowserReasonCode | undefined,
          remedy: exe.remedy ?? mode.remedy,
        }
  if (reason?.reasonCode) {
    status.reasonCode = reason.reasonCode
    if (reason.remedy) status.remedy = reason.remedy
  }
  return status
}

export async function invokeBrowserAction(
  agentId: string,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
  admission?: BrowserAdmission,
  deps?: PoolDeps,
): Promise<ToolResultPart[]> {
  const entry = await admitEntry(agentId, config, admission, deps)
  entry.lastUsedAt = Date.now()
  let cancelledRetirement: Promise<void> | undefined
  let rejectCancellation!: (error: Error) => void
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject
  })
  // Cancellation can arrive before dispatch (including an already-aborted
  // signal). Always observe its rejection, even if check() refuses first.
  void cancellation.catch(() => {})
  const cancel = () => {
    // Capture this entry, never look up a later turn's replacement session.
    cancelledRetirement ??= entry.close(true)
    void cancelledRetirement.then(
      () =>
        rejectCancellation(new Error('browser: the turn was cancelled; effects may be uncertain')),
      rejectCancellation,
    )
  }
  const check = () => {
    assertNotCancelled(admission)
    if (entry.state !== 'running' || resources().browsers.get(agentId) !== entry) {
      throw new PoolError(
        'browser_busy',
        'the browser session was retired; effects may be uncertain',
      )
    }
  }
  admission?.signal?.addEventListener('abort', cancel, { once: true })
  let result: ToolResultPart[] = []
  let failed = false
  let actionError: unknown
  try {
    check()
    result = await Promise.race([
      withActionLock(entry, async () => {
        check() // a queued call may have been cancelled/retired while waiting
        return dispatchBrowserAction(entry, action, args, config, check)
      }),
      cancellation,
      retirementSignal(entry),
    ])
    check()
  } catch (error) {
    failed = true
    actionError = error
  } finally {
    entry.busy--
    entry.lastUsedAt = Date.now()
    admission?.signal?.removeEventListener('abort', cancel)
    if (admission?.signal?.aborted) cancel()
    if (cancelledRetirement) await cancelledRetirement
  }
  // Closing Chromium can reject its pending operation before the explicit
  // cancellation promise settles. Prioritize uncertain cleanup, then report
  // the same cancellation either way, without throwing from a finally block.
  if (cancelledRetirement && entry.state === 'recovery_required') {
    throw new PoolError('browser_recovery_required', 'cancelled browser cleanup is uncertain')
  }
  assertNotCancelled(admission)
  if (failed) throw actionError
  return result
}

async function dispatchBrowserAction(
  entry: ManagedBrowserEntry,
  action: string,
  args: Record<string, unknown>,
  config: BrowserConfig,
  check: () => void,
): Promise<ToolResultPart[]> {
  const agentId = entry.agentId
  const session = runningSession(entry)
  const page = (): Page => {
    check()
    return activePage(entry)
  }

  // Guard top-level navigations explicitly: a navigation to file:// (or any
  // non-http(s) scheme) never reaches the SSRF proxy, so block it here. For
  // http(s) this also returns a clean error for private targets instead of a
  // bare proxy connection failure.
  async function guardNav(url: string): Promise<void> {
    const reason = await browserBlockReason(url, config.allowPrivate)
    check()
    if (reason) throw new PoolError('browser_busy', `browser navigation blocked: ${reason}`)
  }

  // Every text-producing action returns a bounded observation; a mutating
  // action invalidates the previous observation's cursors first.
  const observe = async (
    ref?: string,
    scope?: BrowserSnapshotScope,
  ): Promise<FormattedObservation> => {
    const target = page()
    const tabId = session.obs.tabId(target) ?? session.obs.registerTab(target)
    try {
      return await session.obs.capture({
        agentId,
        tabId,
        page: target,
        ...(ref !== undefined ? { ref } : {}),
        ...(scope !== undefined ? { scope } : {}),
      })
    } catch (error) {
      if (error instanceof ObservationExpiredError) {
        throw new PoolError('browser_observation_expired', error.message)
      }
      throw error
    }
  }

  switch (action) {
    case 'navigate': {
      const url = str(args, 'url')
      await guardNav(url)
      const target = page()
      session.obs.invalidate()
      await target.goto(url, { waitUntil: 'domcontentloaded' })
      return text((await observe()).text)
    }
    case 'snapshot': {
      const hasRef = args.ref !== undefined
      const hasCursor = args.cursor !== undefined
      const hasScope = args.scope !== undefined
      if (Number(hasRef) + Number(hasCursor) + Number(hasScope) > 1) {
        throw new PoolError(
          'browser_busy',
          'browser_snapshot takes only one of ref, cursor or scope',
        )
      }
      if (hasScope && !BROWSER_SNAPSHOT_SCOPES.some((scope) => scope === args.scope)) {
        throw new PoolError('browser_busy', 'browser_snapshot scope must be dialog, main or search')
      }
      if (isBlank(page())) return text(NO_PAGE_HINT)
      if (hasScope) return text((await observe(undefined, args.scope as BrowserSnapshotScope)).text)
      if (hasCursor) {
        // Continuation: the NEXT page of the same frozen observation.
        const cursorId = str(args, 'cursor')
        if (!session.obs.getCurrentObservationId()) {
          throw new PoolError(
            'browser_observation_expired',
            'no observation is active; take a fresh browser_snapshot',
          )
        }
        const target = page()
        const formatted = session.obs.continue(cursorId)
        session.obs.consume(cursorId)
        // A changed page invalidates the frozen observation.
        try {
          await session.obs.assertFresh(target)
        } catch (error) {
          if (error instanceof ObservationExpiredError) {
            session.obs.invalidate()
            throw new PoolError('browser_observation_expired', error.message)
          }
          throw error
        }
        return text(formatted.text)
      }
      if (isBlank(page())) return text(NO_PAGE_HINT)
      if (hasRef) {
        // Ref-scoped capture: must reference the current observation.
        const ref = elementRef(args.ref)
        session.obs.requireCurrentObservation(args.observationId)
        return text((await observe(ref)).text)
      }
      return text((await observe()).text)
    }
    case 'click': {
      const ref = elementRef(args.ref)
      return actOnRef(
        entry,
        ref,
        args.observationId,
        () => observe(),
        () => page().locator(`aria-ref=${ref}`).click(),
      )
    }
    case 'type': {
      const ref = elementRef(args.ref)
      return actOnRef(
        entry,
        ref,
        args.observationId,
        () => observe(),
        async () => {
          const loc = page().locator(`aria-ref=${ref}`)
          await loc.fill(typeof args.text === 'string' ? args.text : '')
          check()
          if (args.submit === true) await loc.press('Enter')
        },
      )
    }
    case 'hover': {
      const ref = elementRef(args.ref)
      return actOnRef(
        entry,
        ref,
        args.observationId,
        () => observe(),
        () => page().locator(`aria-ref=${ref}`).hover(),
      )
    }
    case 'select': {
      const ref = elementRef(args.ref)
      const values = Array.isArray(args.values) ? (args.values as string[]) : [str(args, 'value')]
      return actOnRef(
        entry,
        ref,
        args.observationId,
        () => observe(),
        () => page().locator(`aria-ref=${ref}`).selectOption(values),
      )
    }
    case 'fill_form': {
      if (!Array.isArray(args.fields) || args.fields.length === 0) {
        throw new PoolError('browser_busy', 'browser action: fields must be a non-empty array')
      }
      // Validate every field before dispatch, including shape and value type:
      // a malformed later field must never leave earlier fields changed.
      const fields = args.fields.map((field: unknown) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          throw new PoolError('browser_busy', 'browser action: each field needs a ref and value')
        }
        const record = field as Record<string, unknown>
        const ref = elementRef(record.ref)
        if (typeof record.value !== 'string') {
          throw new PoolError('browser_busy', 'browser action: field value must be a string')
        }
        return { ref, value: record.value }
      })
      const refs = fields.map((f) => f.ref).join(',')
      return actOnRef(
        entry,
        refs,
        args.observationId,
        () => observe(),
        async () => {
          for (const f of fields) {
            if (!f.ref) continue
            await page()
              .locator(`aria-ref=${f.ref}`)
              .fill(f.value ?? '')
          }
        },
      )
    }
    case 'press_key': {
      const key = str(args, 'key')
      const target = page()
      session.obs.invalidate()
      await target.keyboard.press(key)
      return text((await observe()).text)
    }
    case 'go_back': {
      const target = page()
      session.obs.invalidate()
      await target.goBack({ waitUntil: 'domcontentloaded' })
      return text((await observe()).text)
    }
    case 'tabs': {
      const op = str(args, 'op')
      const pages = session.context.pages().filter((p) => !p.isClosed())
      if (op === 'list') {
        // Bounded, stable-tab-id listing (no positional indexes).
        const lines = session.obs
          .tabs(pages)
          .map((t) => `${t.active ? '*' : ' '} ${t.tabId}  ${t.url}`)
        return text(boundText(lines.join('\n') || 'no open tabs'))
      }
      if (op === 'new') {
        if (pages.length >= MAX_TABS) {
          throw new PoolError(
            'browser_capacity_reached',
            `this agent already has ${MAX_TABS} open tabs (the limit); close one first`,
          )
        }
        if (typeof args.url === 'string' && args.url) await guardNav(args.url)
        check()
        session.obs.invalidate()
        const created = await session.context.newPage()
        check()
        const tabId = session.obs.registerTab(created)
        session.obs.setActiveTab(tabId)
        if (typeof args.url === 'string' && args.url) {
          await created.goto(args.url, { waitUntil: 'domcontentloaded' })
        }
        return text((await observe()).text)
      }
      if (op === 'select') {
        // Stable session-local tab ids — positional indexes are gone.
        const tabId = tabRef(args.tabId)
        const target = session.obs.pageForTab(pages, tabId)
        if (!target) {
          throw new PoolError(
            'browser_busy',
            `no open tab with id "${tabId}"; use browser_tabs {"op":"list"} for current ids`,
          )
        }
        // Logical selection alone leaves a different native tab active. In direct/CDP macOS
        // headless Chromium that can suspend the selected page's observation polling. Activate
        // the actual target, with old authority revoked before the await; never publish fresh
        // refs until activation settles under this same entry's lease.
        session.obs.invalidate()
        await target.bringToFront()
        check()
        session.obs.setActiveTab(tabId)
        return text((await observe()).text)
      }
      if (op === 'close') {
        const tabId = tabRef(args.tabId)
        const target = session.obs.pageForTab(pages, tabId)
        if (!target) {
          // Closing an already-closed/unknown tab is handled cleanly.
          return text(`tab "${tabId}" is not open; nothing to close`)
        }
        session.obs.invalidate()
        await target.close()
        if (pages.length - 1 === 0)
          return text('all tabs are closed; browser_navigate to open a page')
        if (session.obs.getActiveTab() === tabId)
          session.obs.setActiveTab(
            session.obs.tabs(pages.filter((p) => !p.isClosed()))[0]?.tabId ?? '',
          )
        return text((await observe()).text)
      }
      throw new PoolError(
        'browser_busy',
        boundText(`unknown tabs op: ${op} (expected list|new|select|close)`),
      )
    }
    case 'take_screenshot': {
      // Don't hand back a useless blank PNG (and tempt the model to narrate it
      // as a real page) when nothing has been navigated to yet.
      if (isBlank(page())) return text(NO_PAGE_HINT)
      const buf = await page().screenshot({
        type: 'png',
        fullPage: args.full_page === true,
      })
      // D2: refuse an over-bound decoded image — never truncate silently.
      assertScreenshotWithinBound(buf)
      return [
        { type: 'text', text: boundText(`Screenshot of ${page().url()}`) },
        { type: 'image', data: buf.toString('base64'), mimeType: 'image/png' },
      ]
    }
    case 'console': {
      if (session.console.length === 0) return text('no console messages')
      return text(boundText(session.console.map((c) => `[${c.type}] ${c.text}`).join('\n')))
    }
    case 'network': {
      if (session.network.length === 0) return text('no network requests recorded')
      return text(
        boundText(
          session.network.map((n) => `${n.method} ${n.status ?? '...'} ${n.url}`).join('\n'),
        ),
      )
    }
    default:
      throw new PoolError('browser_busy', boundText(`unknown browser action: ${action}`))
  }
}
