// Bounded observations with frozen paging (BAZ-069 D5/T08).
//
// Every capture names an opaque observationId, a stable session-local tabId,
// the capture time, and explicit truncated/hasMore facts; retained text
// continues through expiring, agent/tab/generation-bound cursors. One current
// capture exists per session: a new capture, navigation, mutating action, tab
// switch/close or browser retirement replaces it and invalidates its cursors.
// Continuation requires the captured document generation to still match — a
// changed page yields `browser_observation_expired` instead of stale content.
//
// All text-producing action results go through the same bounded formatter:
// UTF-8-safe, line-aligned chunks inside the 32 KiB response bound, metadata
// included. A capture larger than the 512 KiB capture bound is never reported
// as complete.

import { createHash, randomUUID } from 'node:crypto'
import { BROWSER_SNAPSHOT_SCOPES, type BrowserSnapshotScope } from '@bazilion/api-types'
import type { Locator, Page } from 'playwright'

/** D2: returned browser text (metadata included) per tool result. */
export const RESPONSE_BOUND_BYTES = 32_768
/** D2: captured observation lifetime bound. */
export const CAPTURE_BOUND_BYTES = 512 * 1024
/** D2: cursor expiry. */
export const CURSOR_TTL_MS = 5 * 60_000
/** Headroom for the metadata header inside the response bound. */
const CHUNK_BYTES = 24 * 1024
/** Refuse known over-broad scopes before asking Playwright to serialize them. */
const DOM_NODE_BOUND = 10_000
/** Maximum traversal performed by the injected instrumentation. */
export const DOM_SCAN_NODE_BOUND = 200_000
/** Read-only settling, never an action retry or a network-idle wait. */
export const CAPTURE_READY_TIMEOUT_MS = 2_000
export class ObservationExpiredError extends Error {
  readonly reasonCode = 'browser_observation_expired' as const
  constructor(message: string) {
    super(message)
    this.name = 'ObservationExpiredError'
  }
}

export interface DomStats {
  docId: string
  generation: number
  nodes: number
  textChars: number
}

/** The trusted in-page instrumentation installed by the managed guards. */
export async function readDomStats(page: Page, scope?: string | Locator): Promise<DomStats | null> {
  try {
    const stats = (await (scope === undefined
      ? page.evaluate('window.__bazilion_obs.stats()')
      : (typeof scope === 'string' ? page.locator(scope) : scope).evaluate(
          (root) =>
            (
              globalThis as unknown as {
                __bazilion_obs?: { stats(root: unknown): DomStats }
              }
            ).__bazilion_obs?.stats(root),
          undefined,
          { timeout: 1_000 },
        ))) as DomStats | undefined | null
    if (!stats || typeof stats !== 'object') return null
    if (typeof stats.docId !== 'string' || typeof stats.generation !== 'number') return null
    if (
      ![stats.generation, stats.nodes, stats.textChars].every((n) => Number.isFinite(n) && n >= 0)
    )
      return null
    return stats
  } catch {
    return null // page closed / navigating: treat as expired
  }
}

type ScopeRefusal =
  | 'scope_absent'
  | 'scope_ambiguous'
  | 'scope_stats_unavailable'
  | 'scope_over_budget'

/** Resolve exactly one accessible region. No picking an arbitrary match or broad fallback. */
async function scopeRefusal(page: Page, locator: Locator): Promise<ScopeRefusal | null> {
  try {
    const count = await locator.count()
    if (count === 0) return 'scope_absent'
    if (count !== 1) return 'scope_ambiguous'
    const stats = await readDomStats(page, locator)
    if (!stats) return 'scope_stats_unavailable'
    if (stats.nodes > DOM_NODE_BOUND || stats.textChars > CAPTURE_BOUND_BYTES)
      return 'scope_over_budget'
    return null
  } catch {
    return 'scope_stats_unavailable'
  }
}

/** The number of bytes `text` would occupy as UTF-8. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Cut a string at a byte limit without splitting a code point. */
export function cutAtCodePoint(text: string, limitBytes: number): number {
  let bytes = 0
  let cut = 0
  for (const ch of text) {
    const width = byteLength(ch)
    if (bytes + width > limitBytes) break
    bytes += width
    cut += ch.length
  }
  return cut
}

/**
 * Split retained text into UTF-8-safe, line-aligned chunks that each fit the
 * byte limit. A single line longer than the limit is hard-split at code-point
 * boundaries (never mid-code-point, never inside a surrogate pair).
 */
export function chunkText(text: string, limitBytes = CHUNK_BYTES): string[] {
  if (text.length === 0) return ['']
  if (byteLength(text) <= limitBytes) return [text]
  const chunks: string[] = []
  let current = ''
  const flush = () => {
    if (current.length > 0) chunks.push(current)
    current = ''
  }
  for (const line of text.split('\n')) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`
    if (byteLength(candidate) <= limitBytes) {
      current = candidate
      continue
    }
    flush()
    if (byteLength(line) <= limitBytes) {
      current = line
      continue
    }
    // Oversized line: split at code-point-safe byte boundaries.
    let rest = line
    while (byteLength(rest) > limitBytes) {
      const cut = cutAtCodePoint(rest, limitBytes)
      if (cut === 0) break // defensive: limit smaller than one code point
      chunks.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  flush()
  return chunks
}

export interface Observation {
  observationId: string
  agentId: string
  tabId: string
  capturedAt: number
  /** Daemon-observed URL identity; retain a digest, not an unbounded raw URL. */
  urlDigest: string
  docId: string | null
  generation: number | null
  chunks: string[]
  /** Retained bytes (what cursors can page through). */
  retainedBytes: number
  /** False when the capture exceeded the capture bound or was depth-limited. */
  complete: boolean
}

export interface CursorRecord {
  id: string
  observationId: string
  tabId: string
  chunkIndex: number
  expiresAt: number
}

export interface FormattedObservation {
  text: string
  observationId: string
  tabId: string
  truncated: boolean
  hasMore: boolean
  nextCursor: string | null
}

function header(obs: Observation, chunkIndex: number, cursorId: string | null): string {
  const hasMore = chunkIndex < obs.chunks.length - 1
  const lines = [
    `- Observation: ${obs.observationId} (tab ${obs.tabId}, captured ${new Date(obs.capturedAt).toISOString()})`,
    `- Complete capture: ${obs.complete ? 'yes' : 'NO — partial or unavailable capture; scope with a ref or read a narrower source'}`,
    `- More text: ${hasMore ? `yes — chunk ${chunkIndex + 1}/${obs.chunks.length}; next cursor: ${cursorId}` : 'no'}`,
  ]
  return lines.join('\n')
}

export interface CaptureInput {
  agentId: string
  tabId: string
  page: Page
  /**
   * Scope the capture to one ref from the current observation. Only call with
   * a ref after `requireCurrentObservation` accepted the observationId: refs
   * are only valid against the observation they came from.
   */
  ref?: string
  /** Ref-independent read of exactly one accessible semantic region. */
  scope?: BrowserSnapshotScope
  now?: () => number
}

/**
 * One session's observation state: the tabs registry, the current capture and
 * its cursors. Daemon-memory-only; nothing here is ever persisted.
 */
export class SessionObservations {
  private readonly cursors = new Map<string, CursorRecord>()
  private current: Observation | null = null
  /** Invalidates in-flight publication/checks, not just already-published refs. */
  private revision = 0
  private readonly tabIds = new WeakMap<Page, string>()
  private tabCounter = 0
  private activeTab: string | null = null
  private readonly nowFn: () => number

  constructor(
    private readonly agentId: string,
    now?: () => number,
  ) {
    this.nowFn = now ?? (() => Date.now())
  }

  // --- tabs ---

  /** Assign (or return) the stable session-local tab id for a page. */
  registerTab(page: Page): string {
    const existing = this.tabIds.get(page)
    if (existing) return existing
    this.tabCounter++
    const tabId = `tab-${this.tabCounter}`
    this.tabIds.set(page, tabId)
    if (this.activeTab === null) this.activeTab = tabId
    return tabId
  }

  tabId(page: Page): string | null {
    return this.tabIds.get(page) ?? null
  }

  /** Page for a stable tab id, or null when the tab is unknown or closed. */
  pageForTab(pages: Page[], tabId: string): Page | null {
    for (const page of pages) {
      if (this.tabIds.get(page) === tabId && !page.isClosed()) return page
    }
    return null
  }

  /** Register every current context page (call at admission and for popups). */
  registerPages(pages: Page[]): void {
    for (const page of pages) this.registerTab(page)
  }

  tabs(pages: Page[]): Array<{ tabId: string; url: string; active: boolean }> {
    return pages
      .filter((p) => !p.isClosed())
      .map((p) => {
        const tabId = this.registerTab(p)
        return { tabId, url: p.url(), active: tabId === this.activeTab }
      })
  }

  getActiveTab(): string | null {
    return this.activeTab
  }

  setActiveTab(tabId: string): void {
    if (this.activeTab !== tabId) this.invalidate()
    this.activeTab = tabId
  }

  // --- capture ---

  getCurrentObservationId(): string | null {
    return this.current?.observationId ?? null
  }

  /**
   * Ref interactions must target the current observation: a stale or
   * cross-session observationId is rejected before acting.
   */
  requireCurrentObservation(observationId: unknown): void {
    if (typeof observationId !== 'string' || !observationId) {
      throw new ObservationExpiredError(
        'this interaction requires the observationId of the current browser_snapshot result',
      )
    }
    if (!this.current || this.current.observationId !== observationId) {
      throw new ObservationExpiredError(
        'that observationId is stale — the page changed or a newer observation exists; take a fresh browser_snapshot and use its observationId',
      )
    }
  }

  /** Drop all cursors and the current capture (navigation / mutation / retirement). */
  invalidate(): void {
    this.revision++
    this.cursors.clear()
    this.current = null
  }

  /** Canonical daemon-owned identity; never trust capture-input labels alone. */
  assertCaptureBinding(input: CaptureInput): void {
    if (input.agentId !== this.agentId) {
      throw new ObservationExpiredError('the capture belongs to a different Agent session')
    }
    const tabId = this.tabIds.get(input.page) ?? this.registerTab(input.page)
    if (input.tabId !== tabId || this.activeTab !== tabId || input.page.isClosed()) {
      throw new ObservationExpiredError('the capture does not name the active session tab')
    }
  }

  /** Opaque daemon-only lease for work performed before capture admission. */
  publicationLease(input: CaptureInput): () => void {
    const { page, agentId, tabId } = input
    this.assertCaptureBinding({ page, agentId, tabId })
    const revision = this.revision
    return () => this.assertPublicationLease(revision, page, tabId)
  }

  private assertPublicationLease(revision: number, page: Page, tabId: string): void {
    if (
      this.revision !== revision ||
      page.isClosed() ||
      this.tabIds.get(page) !== tabId ||
      this.activeTab !== tabId
    ) {
      throw new ObservationExpiredError('the capture was invalidated before publication')
    }
  }

  /** The captured document generation no longer matches the live page. */
  async assertFresh(page: Page): Promise<void> {
    const obs = this.current
    if (!obs) throw new ObservationExpiredError('no current observation')
    if (obs.docId === null) {
      throw new ObservationExpiredError(
        'page freshness could not be established; take a fresh snapshot',
      )
    }
    const revision = this.revision
    const stats = await readDomStats(page)
    if (
      this.current !== obs ||
      this.revision !== revision ||
      page.isClosed() ||
      this.tabIds.get(page) !== obs.tabId ||
      this.activeTab !== obs.tabId ||
      createHash('sha256').update(page.url()).digest('hex') !== obs.urlDigest ||
      !stats ||
      stats.nodes > DOM_SCAN_NODE_BOUND ||
      stats.docId !== obs.docId ||
      stats.generation !== obs.generation
    ) {
      throw new ObservationExpiredError(
        'the page changed since this observation was captured; take a fresh browser_snapshot',
      )
    }
  }

  /**
   * Preflight known oversized scopes before serialization. Prefer a bounded
   * main region when the whole page is too large; otherwise refuse capture.
   * DOM estimates are not byte bounds: ALWAYS clamp the resulting retained
   * snapshot too (including attributes, generated labels and UTF-8 expansion).
   */
  async capture(input: CaptureInput): Promise<FormattedObservation> {
    // Freeze primitives before any await: the request object is not a lease.
    const { page, agentId, tabId, ref, scope } = input
    if (scope !== undefined && (!BROWSER_SNAPSHOT_SCOPES.includes(scope) || ref !== undefined)) {
      throw new Error('capture scope must be dialog, main or search, without a ref')
    }
    if (ref !== undefined && (typeof ref !== 'string' || !/^e\d{1,9}$/.test(ref))) {
      throw new ObservationExpiredError('capture ref must be an observed element ref')
    }
    this.assertCaptureBinding({ page, agentId, tabId })
    // A ref-scoped read must validate the old observation before consuming it.
    const previous = this.current
    if (ref !== undefined) {
      await this.assertFresh(page)
      if (this.current !== previous) {
        throw new ObservationExpiredError('the source observation changed during capture admission')
      }
    }
    // Every attempted capture consumes previous authority, even when it fails.
    this.invalidate()
    const revision = this.revision
    // A click may return while the new document still lacks a body. Wait only
    // for attachment, with a fixed deadline; never replay the action, reload,
    // or wait indefinitely for network idle. Read stats AFTER this wait.
    await page.locator('body').waitFor({ state: 'attached', timeout: CAPTURE_READY_TIMEOUT_MS })
    this.assertPublicationLease(revision, page, tabId)
    const urlDigest = createHash('sha256').update(page.url()).digest('hex')

    // Whole-document stats remain authoritative for freshness/coverage, NOT
    // the serialization budget of a smaller root (e.g. a body below a huge head).
    const stats = await readDomStats(page)
    // Copy the stamp: mutable evaluator return objects are not evidence.
    const stamp = stats ? { docId: stats.docId, generation: stats.generation } : null
    let label: string = scope ?? (ref === undefined ? 'body' : 'ref')
    let locator =
      scope !== undefined
        ? page.getByRole(scope)
        : page.locator(ref === undefined ? 'body' : `aria-ref=${ref}`)
    let refusal = await scopeRefusal(page, locator)
    const refusals: string[] = refusal ? [`${label}: ${refusal}`] : []
    let complete = scope === undefined
    if (refusal && ref === undefined && scope === undefined) {
      // Role resolution includes native and ARIA main, excluding inaccessible
      // regions. Multiple matches refuse instead of silently choosing the first.
      label = 'main'
      locator = page.getByRole('main')
      refusal = await scopeRefusal(page, locator)
      if (refusal) refusals.push(`main: ${refusal}`)
      complete = false
    }
    let text: string
    if (refusal) {
      text =
        `No bounded snapshot is available for this scope (${refusals.join('; ')}). ` +
        'Request scope="dialog", "main" or "search" for one accessible region without old refs. ' +
        'These are read-only observations, not permission to bypass a blocker.'
      complete = false
    } else {
      text = await locator.ariaSnapshot({ mode: 'ai', timeout: CAPTURE_READY_TIMEOUT_MS })
      if (label !== 'body' && label !== 'ref')
        text = `Partial capture: ${label} region only.\n\n${text}`
    }
    if (byteLength(text) > CAPTURE_BOUND_BYTES) {
      text = text.slice(0, cutAtCodePoint(text, CAPTURE_BOUND_BYTES))
      complete = false
    }

    const after = await readDomStats(page)
    this.assertPublicationLease(revision, page, tabId)
    if (
      createHash('sha256').update(page.url()).digest('hex') !== urlDigest ||
      (stamp && after && (stamp.docId !== after.docId || stamp.generation !== after.generation))
    ) {
      throw new ObservationExpiredError(
        'the page changed while its snapshot was captured; take a fresh browser_snapshot',
      )
    }
    const hasFreshness =
      !refusal &&
      stamp !== null &&
      after !== null &&
      (stats?.nodes ?? Infinity) <= DOM_SCAN_NODE_BOUND &&
      after.nodes <= DOM_SCAN_NODE_BOUND
    if (!hasFreshness) complete = false
    const chunks = chunkText(text)
    const obs: Observation = {
      observationId: randomUUID(),
      agentId,
      tabId,
      capturedAt: this.nowFn(),
      urlDigest,
      // An unavailable capture issued no refs. It must not re-authorize refs
      // cached by Playwright from an earlier snapshot with a new observation id.
      docId: hasFreshness ? (stamp?.docId ?? null) : null,
      generation: hasFreshness ? (stamp?.generation ?? null) : null,
      chunks,
      retainedBytes: byteLength(text),
      complete,
    }
    this.current = obs
    this.cursors.clear()
    return this.format(obs, 0)
  }

  /** Format chunk `index` of an observation with its metadata header. */
  format(obs: Observation, index: number): FormattedObservation {
    const hasMore = index < obs.chunks.length - 1
    let cursorId: string | null = null
    if (hasMore) {
      cursorId = randomUUID()
      this.cursors.set(cursorId, {
        id: cursorId,
        observationId: obs.observationId,
        tabId: obs.tabId,
        chunkIndex: index + 1,
        expiresAt: this.nowFn() + CURSOR_TTL_MS,
      })
    }
    const body = obs.chunks[index] ?? ''
    return {
      text: `${header(obs, index, cursorId)}\n\n${body}`,
      observationId: obs.observationId,
      tabId: obs.tabId,
      truncated: !obs.complete || hasMore,
      hasMore,
      nextCursor: cursorId,
    }
  }

  /** Continue a frozen observation from a cursor (same capture, next chunk). */
  continue(cursorId: string): FormattedObservation {
    const record = this.cursors.get(cursorId)
    if (!record) {
      throw new ObservationExpiredError(
        'unknown or already-used cursor; take a fresh browser_snapshot',
      )
    }
    if (this.nowFn() > record.expiresAt) {
      this.cursors.delete(cursorId)
      throw new ObservationExpiredError(
        'that cursor expired (cursors last five minutes); take a fresh browser_snapshot',
      )
    }
    const obs = this.current
    if (!obs || obs.observationId !== record.observationId) {
      throw new ObservationExpiredError(
        'that cursor belongs to an older observation; take a fresh browser_snapshot',
      )
    }
    // Synchronous validity first; page-generation freshness is checked by the
    // caller (async) before continuing.
    return this.format(obs, record.chunkIndex)
  }

  /** Drop a cursor after use — cursors are single-use. */
  consume(cursorId: string): void {
    this.cursors.delete(cursorId)
  }

  cursorCountForTest(): number {
    return this.cursors.size
  }
}

// --- bounded formatting for non-observation action text ---

/** Cap any action text to the response bound, code-point safely. */
export function boundText(text: string, limitBytes = RESPONSE_BOUND_BYTES): string {
  if (byteLength(text) <= limitBytes) return text
  const suffix = '\n… (truncated at the response bound)'
  const keep = limitBytes - Buffer.byteLength(suffix, 'utf8')
  return `${text.slice(0, cutAtCodePoint(text, keep))}${suffix}`
}

// --- screenshot bound (D2: 8 MiB decoded; refuse, never truncate silently) ---

export const MAX_SCREENSHOT_DECODED_BYTES = 8 * 1024 * 1024

/**
 * Refuse a screenshot whose decoded size would exceed the bound, based on the
 * PNG IHDR dimensions (w × h × 4 bytes). Never truncates an image silently.
 */
export function assertScreenshotWithinBound(png: Buffer): void {
  if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('screenshot did not return a PNG image')
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const decoded = width * height * 4
  if (decoded > MAX_SCREENSHOT_DECODED_BYTES) {
    throw new Error(
      `screenshot would decode to ~${Math.round(decoded / (1024 * 1024))} MiB (${width}×${height}), ` +
        'over the 8 MiB bound. Take a viewport screenshot (full_page omitted) instead of a full-page one.',
    )
  }
}
