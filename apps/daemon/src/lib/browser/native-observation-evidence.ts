// Read-only engineering candidate. Not used by production action admission.
// CDP measurements avoid page-realm globals/prototypes. No outside-target
// payload is discarded. The returned evidence is NOT an assertion of complete
// coverage, capture coherence, or arbitrary application JS behavior.
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { CDPSession, Page } from 'playwright'
import {
  assertScreenshotWithinBound,
  type CaptureInput,
  type FormattedObservation,
  MAX_SCREENSHOT_DECODED_BYTES,
  ObservationExpiredError,
  type SessionObservations,
} from './observation.ts'

const MAX_STATE_BYTES = 4 * 1024 * 1024
const MAX_NODES = 10_000
const DEADLINE_MS = 2_000
const STYLES = [
  'display',
  'visibility',
  'opacity',
  'pointer-events',
  'position',
  'z-index',
  'transform',
  'filter',
  'clip-path',
  'overflow',
  'color',
  'background-color',
  'background-image',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'content',
  'cursor',
  'text-decoration',
  'writing-mode',
]

export type NativeObservationEvidence =
  | {
      kind: 'captured'
      digest: string
      bytes: number
      nodes: number
      coverage: 'unqualified'
      coherence: 'unqualified'
    }
  | { kind: 'unknown'; reason: 'unavailable' | 'over-budget' | 'retired' }
export type NativeCleanupOutcome = 'detached' | 'failed' | 'timed-out'

/** Diagnostic binding only: unqualified samples cannot authorize an action. */
export interface NativePublicationCandidate {
  readonly observation: FormattedObservation
  readonly evidence: Readonly<{
    agentId: string
    tabId: string
    observationId: string
    deliveredTextDigest: string
    sample: Extract<NativeObservationEvidence, { kind: 'captured' }>
  }>
}

export class NativeObservationReader {
  private retired = false
  private busy = false
  private cleanup: Promise<NativeCleanupOutcome> | undefined
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async create(page: Page): Promise<NativeObservationReader> {
    const deadline = performance.now() + DEADLINE_MS
    let expired = false
    let reader: NativeObservationReader | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true
        void reader?.dispose()
        reject(new Error('native evidence setup deadline expired'))
      }, DEADLINE_MS)
    })
    const setup = (async () => {
      const cdp = await page.context().newCDPSession(page)
      reader = new NativeObservationReader(page, cdp)
      if (expired || performance.now() >= deadline) {
        throw new Error('native evidence setup deadline expired')
      }
      // Stable AX ids; never install page-world code or a global API.
      await cdp.send('Accessibility.enable')
      if (expired || performance.now() >= deadline) {
        throw new Error('native evidence setup deadline expired')
      }
      return reader
    })().catch((error: unknown) => {
      // This also retires a session arriving after the setup race expired.
      void reader?.dispose()
      throw error
    })
    try {
      return await Promise.race([setup, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async read(): Promise<NativeObservationEvidence> {
    if (this.retired || this.page.isClosed()) return { kind: 'unknown', reason: 'retired' }
    if (this.busy) return { kind: 'unknown', reason: 'unavailable' }
    this.busy = true
    const deadline = performance.now() + DEADLINE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<NativeObservationEvidence>((resolve) => {
      timer = setTimeout(() => {
        void this.dispose()
        resolve({ kind: 'unknown', reason: 'unavailable' })
      }, DEADLINE_MS)
    })
    try {
      return await Promise.race([this.measure(deadline), expired])
    } catch {
      return { kind: 'unknown', reason: 'unavailable' }
    } finally {
      if (timer) clearTimeout(timer)
      this.busy = false
    }
  }

  /**
   * Bind diagnostic samples to the actual daemon publication, never to labels
   * or freshly-read stamps supplied after publication. This is not a fallback
   * authorizer: coverage and cross-channel coherence remain unqualified.
   */
  async capturePublicationCandidate(
    observations: SessionObservations,
    input: CaptureInput,
  ): Promise<NativePublicationCandidate> {
    const { page, agentId, tabId, ref, scope } = input
    const request: CaptureInput = { page, agentId, tabId, ref, scope }
    if (page !== this.page) {
      throw new ObservationExpiredError('native evidence belongs to a different Page')
    }
    const checkAdmissionLease = observations.publicationLease(request)
    const sourceObservationId = observations.getCurrentObservationId()
    if (ref !== undefined) observations.requireCurrentObservation(sourceObservationId)
    const before = await this.read()
    if (before.kind !== 'captured') {
      throw new ObservationExpiredError('native publication sample unavailable')
    }
    let observation: FormattedObservation | undefined
    try {
      checkAdmissionLease()
      if (ref !== undefined) observations.requireCurrentObservation(sourceObservationId)
      observation = await observations.capture(request)
      const after = await this.read()
      if (after.kind !== 'captured' || before.digest !== after.digest) {
        throw new ObservationExpiredError(
          'native state changed or became unavailable during publication',
        )
      }
      // Revalidate after native I/O; a tab switch/invalidation or a newer
      // publication cannot resurrect this candidate's old authority.
      observations.requireCurrentObservation(observation.observationId)
      await observations.assertFresh(page)
      observations.requireCurrentObservation(observation.observationId)
      observations.assertCaptureBinding(request)
      if (this.retired || page.isClosed()) {
        throw new ObservationExpiredError('native publication reader retired before completion')
      }
      return Object.freeze({
        observation: Object.freeze(observation),
        evidence: Object.freeze({
          agentId,
          tabId,
          observationId: observation.observationId,
          deliveredTextDigest: createHash('sha256').update(observation.text).digest('hex'),
          sample: Object.freeze(after),
        }),
      })
    } catch (error) {
      // Do not poison a newer capture if this one finishes late.
      if (observation && observations.getCurrentObservationId() === observation.observationId) {
        observations.invalidate()
      }
      throw error
    }
  }

  private assertWithinDeadline(deadline: number): void {
    if (this.retired || this.page.isClosed() || performance.now() >= deadline) {
      void this.dispose()
      throw new Error('native evidence capture unavailable or expired')
    }
  }

  private async measure(deadline: number): Promise<NativeObservationEvidence> {
    // Includes live inputs, backend node identity, pseudo/shadow data and
    // listener metadata. Unsupported CDP is unknown, never page evaluation.
    const dom = await this.cdp.send('DOMSnapshot.getSnapshot', {
      computedStyleWhitelist: STYLES,
      includeEventListeners: true,
      includePaintOrder: true,
      includeUserAgentShadowTree: true,
    })
    this.assertWithinDeadline(deadline)
    if (dom.domNodes.length > MAX_NODES) return { kind: 'unknown', reason: 'over-budget' }
    const accessibility = await this.cdp.send('Accessibility.getFullAXTree')
    this.assertWithinDeadline(deadline)
    if (accessibility.nodes.length > MAX_NODES) return { kind: 'unknown', reason: 'over-budget' }
    const viewport = await this.cdp.send('Page.getLayoutMetrics')
    this.assertWithinDeadline(deadline)
    const metadata = JSON.stringify({ dom, accessibility, viewport })
    const bytes = Buffer.byteLength(metadata, 'utf8')
    this.assertWithinDeadline(deadline)
    if (bytes > MAX_STATE_BYTES) return { kind: 'unknown', reason: 'over-budget' }
    const screenshot = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    this.assertWithinDeadline(deadline)
    if (screenshot.data.length > 12 * 1024 * 1024) {
      return { kind: 'unknown', reason: 'over-budget' }
    }
    const png = Buffer.from(screenshot.data, 'base64')
    if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') {
      return { kind: 'unknown', reason: 'unavailable' }
    }
    if (png.readUInt32BE(16) * png.readUInt32BE(20) * 4 > MAX_SCREENSHOT_DECODED_BYTES) {
      return { kind: 'unknown', reason: 'over-budget' }
    }
    assertScreenshotWithinBound(png)
    const digest = createHash('sha256').update(metadata).update(png).digest('hex')
    // Timers cannot preempt synchronous work: never report late evidence.
    this.assertWithinDeadline(deadline)
    return {
      kind: 'captured',
      digest,
      bytes: bytes + png.length,
      nodes: dom.domNodes.length,
      coverage: 'unqualified',
      coherence: 'unqualified',
    }
  }

  dispose(): Promise<NativeCleanupOutcome> {
    // Evidence retirement is immediate; cleanup is a separate shared outcome.
    this.retired = true
    if (this.cleanup) return this.cleanup
    const deadline = performance.now() + DEADLINE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<NativeCleanupOutcome>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), DEADLINE_MS)
    })
    const detach = Promise.resolve().then(async (): Promise<NativeCleanupOutcome> => {
      try {
        await this.cdp.detach()
        return performance.now() >= deadline ? 'timed-out' : 'detached'
      } catch {
        return 'failed'
      }
    })
    this.cleanup = Promise.race([detach, timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    // 'failed'/'timed-out' must not be treated as confirmed cleanup by an owner.
    return this.cleanup
  }
}
