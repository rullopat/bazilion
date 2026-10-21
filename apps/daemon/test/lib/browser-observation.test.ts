// T08 — bounded observations: UTF-8-safe line-aligned chunking, frozen-obs
// cursors (expiry / staleness / cross-agent refusal), honest action errors and
// the screenshot bound. Driven with fake pages, so no browser is needed; the
// real capture path is exercised by the gated lane.

import { createHash } from 'node:crypto'
import type { Page } from 'playwright'
import { describe, expect, test } from 'vitest'
import {
  assertScreenshotWithinBound,
  boundText,
  CAPTURE_BOUND_BYTES,
  CAPTURE_READY_TIMEOUT_MS,
  chunkText,
  cutAtCodePoint,
  DOM_SCAN_NODE_BOUND,
  type DomStats,
  type FormattedObservation,
  type Observation,
  ObservationExpiredError,
  readDomStats,
  SessionObservations,
} from '../../src/lib/browser/observation.ts'

// --- chunking ---

describe('chunkText', () => {
  test('small text is one chunk', () => {
    expect(chunkText('hello world', 1000)).toEqual(['hello world'])
  })

  test('a long article continues past the first chunk with line alignment', () => {
    const article = Array.from({ length: 2000 }, (_, i) => `line ${i} of the article`).join('\n')
    const chunks = chunkText(article, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    // No chunk exceeds the byte limit; every chunk re-joins to the original.
    for (const chunk of chunks) expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(1000)
    expect(chunks.join('\n')).toBe(article)
  })

  test('an oversized single line is split code-point safely', () => {
    const line = 'é'.repeat(2000) // 2 bytes per char in UTF-8
    const chunks = chunkText(line, 999)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(999)
      // No split surrogate/mojibake: every chunk decodes cleanly.
      expect(Buffer.from(chunk, 'utf8').toString('utf8')).toBe(chunk)
    }
    expect(chunks.join('')).toBe(line)
  })

  test('emoji (surrogate pairs) are never split', () => {
    const text = '🌍'.repeat(1000) // each is 4 UTF-8 bytes / a surrogate pair
    const chunks = chunkText(text, 333)
    for (const chunk of chunks) {
      for (const ch of chunk) expect(ch.codePointAt(0)).toBe('🌍'.codePointAt(0))
    }
    expect(chunks.join('')).toBe(text)
  })

  test('a CJK (3-byte) boundary never produces mojibake', () => {
    const text = '日本語テキスト'.repeat(300)
    const chunks = chunkText(text, 500)
    expect(chunks.join('')).toBe(text)
    for (const chunk of chunks) {
      // No mojibake: every chunk decodes to itself (a split code point would not).
      expect(Buffer.from(chunk, 'utf8').toString('utf8')).toBe(chunk)
    }
  })
})

describe('cutAtCodePoint', () => {
  test('never splits a surrogate pair', () => {
    const text = `a🌍b` // a(1) + 🌍(4 bytes) + b(1)
    const cut = cutAtCodePoint(text, 2) // would split the emoji
    expect(text.slice(0, cut)).toBe('a')
  })
})

// --- cursors / observations ---

function fakePage(stats: DomStats, overrides: Partial<Record<string, unknown>> = {}): Page {
  const locate = overrides.locator as ((scope: string) => Record<string, unknown>) | undefined
  const locator = (scope: string) => ({
    waitFor: async () => {},
    count: async () => 1,
    evaluate: async () => stats,
    ariaSnapshot: async () => '- fixture content',
    ...locate?.(scope),
  })
  return {
    isClosed: () => false,
    url: () => 'http://fixture.test/page',
    evaluate: async () => stats,
    getByRole: (role: string) => locator(`role=${role}`),
    ...overrides,
    // Decorate caller-supplied locators with the same Page contract defaults.
    locator,
  } as unknown as Page
}

function stats(generation = 0, textChars = 100): DomStats {
  return { docId: 'doc-1', generation, nodes: 10, textChars }
}

function clock() {
  let t = 1_000_000
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

test('capture returns chunk one with metadata and a continuation cursor', async () => {
  const clockState = clock()
  const obs = new SessionObservations('a1', clockState.now)
  const page = fakePage(stats())
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(result.observationId).toBeTruthy()
  expect(result.hasMore).toBe(false)
  expect(result.text).toContain('Complete capture: yes')
  expect(result.text).toContain('- Observation: ')
  expect(result.text).toContain('fixture content')
})

test('capture waits boundedly for a body and reads freshness only after attachment', async () => {
  const obs = new SessionObservations('a1')
  let ready = false
  const page = fakePage(stats(), {
    evaluate: async () => {
      expect(ready).toBe(true)
      return stats(3)
    },
    locator: () => ({
      waitFor: async (options: unknown) => {
        expect(options).toEqual({ state: 'attached', timeout: CAPTURE_READY_TIMEOUT_MS })
        ready = true
      },
      ariaSnapshot: async () => '- new document',
    }),
  })
  expect((await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })).text).toContain(
    'new document',
  )
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
})

test('an oversized DOM is not serialized and never reported complete', async () => {
  const obs = new SessionObservations('a1')
  // textChars over the capture bound: oversized
  const page = fakePage(stats(0, CAPTURE_BOUND_BYTES + 1))
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(result.truncated).toBe(true)
  expect(result.text).toContain('Complete capture: NO')
  expect(result.text).toMatch(/scope with a ref/)
})

test('known large shallow scopes are refused before accessibility serialization', async () => {
  for (const scopeStats of [stats(0, CAPTURE_BOUND_BYTES * 2), { ...stats(), nodes: 20_000 }]) {
    const obs = new SessionObservations('a1')
    let captures = 0
    const page = fakePage(scopeStats, {
      locator: () => ({
        evaluate: async () => scopeStats,
        ariaSnapshot: async () => {
          captures++
          return 'x'.repeat(CAPTURE_BOUND_BYTES * 2)
        },
      }),
    })
    const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
    expect(captures).toBe(0)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('No bounded snapshot')
  }
})

test('retained capture bytes are clamped for both whole-page and partial-main captures', async () => {
  for (const partial of [false, true]) {
    const obs = new SessionObservations('a1')
    const page = fakePage(stats(0, partial ? CAPTURE_BOUND_BYTES * 2 : 100), {
      locator: (scope: string) => ({
        evaluate: async () => stats(0, partial && scope === 'body' ? CAPTURE_BOUND_BYTES * 2 : 100),
        ariaSnapshot: async () => '🌍'.repeat(CAPTURE_BOUND_BYTES),
      }),
    })
    const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
    const retained = (obs as unknown as { current: Observation }).current
    expect(retained.retainedBytes).toBeLessThanOrEqual(CAPTURE_BOUND_BYTES)
    expect(Buffer.byteLength(retained.chunks.join(''), 'utf8')).toBeLessThanOrEqual(
      CAPTURE_BOUND_BYTES,
    )
    expect(retained.chunks.join('')).not.toContain('\uFFFD')
    expect(result.truncated).toBe(true)
    expect(result.hasMore).toBe(true)
  }
})

test('an oversized body can yield a bounded labelled main-region preview', async () => {
  const obs = new SessionObservations('a1')
  const scopes: string[] = []
  const page = fakePage(stats(0, CAPTURE_BOUND_BYTES * 2), {
    locator: (scope: string) => ({
      evaluate: async () => stats(0, scope === 'body' ? CAPTURE_BOUND_BYTES * 2 : 100),
      ariaSnapshot: async () => {
        scopes.push(scope)
        return '- link "Source" [ref=e1]'
      },
    }),
  })
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(scopes).toEqual(['role=main'])
  expect(result.text).toContain('Partial capture: main region only')
  expect(result.truncated).toBe(true)
})

test('scoped stats use an invoked evaluator rather than an inert arrow string', async () => {
  const page = fakePage(stats(), {
    locator: () => ({
      evaluate: async (callback: unknown) => {
        expect(typeof callback).toBe('function')
        return stats()
      },
    }),
  })
  expect(await readDomStats(page, 'body')).toEqual(stats())
})

test('ref-scoped capture still refuses a known oversized subtree without serialization', async () => {
  const obs = new SessionObservations('a1')
  let captures = 0
  const page = fakePage(stats(), {
    locator: (scope: string) => ({
      evaluate: async () => stats(0, scope.startsWith('aria-ref=') ? CAPTURE_BOUND_BYTES + 1 : 100),
      ariaSnapshot: async () => {
        captures++
        return '- button "Read" [ref=e1]'
      },
    }),
  })
  const first = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  obs.requireCurrentObservation(first.observationId)
  const scoped = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, ref: 'e1' })
  expect(captures).toBe(1)
  expect(scoped.text).toContain('ref: scope_over_budget')
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('R12 budgets the actual body rather than an oversized document head', async () => {
  const scopes: string[] = []
  const documentStats = { ...stats(), nodes: 9762, textChars: 674703 }
  const page = fakePage(documentStats, {
    locator: (scope: string) => ({
      evaluate: async () => ({ ...stats(), nodes: 9679, textChars: 508058 }),
      ariaSnapshot: async () => {
        scopes.push(scope)
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  const obs = new SessionObservations('a1')
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(scopes).toEqual(['body'])
  expect(result.text).toContain('Complete capture: yes')
  expect(result.text).toContain('Reject')
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
})

test.each([
  'dialog',
  'main',
  'search',
] as const)('semantic %s capture needs no previous ref and is labelled partial', async (scope) => {
  const roots: string[] = []
  const page = fakePage(stats(0, CAPTURE_BOUND_BYTES * 2), {
    locator: (selector: string) => ({
      evaluate: async () => stats(),
      ariaSnapshot: async () => {
        roots.push(selector)
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  const obs = new SessionObservations('a1')
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, scope })
  expect(roots).toEqual([`role=${scope}`])
  expect(result.text).toContain(`Partial capture: ${scope} region only`)
  expect(result.text).toContain('Complete capture: NO')
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
})

test.each([
  'scope_absent',
  'scope_ambiguous',
  'scope_stats_unavailable',
  'scope_over_budget',
] as const)('semantic refusal %s never serializes or re-authorizes old refs', async (reason) => {
  let captures = 0
  const obs = new SessionObservations('a1')
  const page = fakePage(stats(), {
    locator: (scope: string) =>
      scope === 'body'
        ? {}
        : {
            count: async () =>
              reason === 'scope_absent' ? 0 : reason === 'scope_ambiguous' ? 2 : 1,
            evaluate: async () =>
              reason === 'scope_stats_unavailable' ? null : stats(0, CAPTURE_BOUND_BYTES + 1),
            ariaSnapshot: async () => {
              captures++
              return '- button "Reject" [ref=e1]'
            },
          },
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, scope: 'dialog' })
  expect(captures).toBe(0)
  expect(result.text).toContain(reason)
  expect(result.text).toContain('Complete capture: NO')
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('semantic captures keep whole-document freshness and incomplete-traversal refusal', async () => {
  let docStats = stats()
  const page = fakePage(stats(), {
    evaluate: async () => docStats,
    locator: () => ({ evaluate: async () => stats() }),
  })
  const obs = new SessionObservations('a1')
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, scope: 'dialog' })
  docStats = stats(1) // mutation outside the dialog still invalidates it
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
  docStats = { ...stats(), nodes: DOM_SCAN_NODE_BOUND + 1 }
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, scope: 'dialog' })
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('semantic captures retain UTF-8 and response bounds even when estimates undercount', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats(), {
    locator: () => ({ ariaSnapshot: async () => '🌍'.repeat(CAPTURE_BOUND_BYTES) }),
  })
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page, scope: 'dialog' })
  const retained = (obs as unknown as { current: Observation }).current
  expect(retained.retainedBytes).toBeLessThanOrEqual(CAPTURE_BOUND_BYTES)
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(32_768)
  expect(result.hasMore).toBe(true)
  expect(retained.chunks.join('')).not.toContain('\uFFFD')
})

test('unknown document freshness refuses actions instead of silently skipping validation', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats(), { evaluate: async () => null })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(obs.assertFresh(page)).rejects.toThrow(/freshness could not be established/)
})

test('an incomplete document traversal cannot authorize ref freshness', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage({ ...stats(), nodes: DOM_SCAN_NODE_BOUND + 1 })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('cursors page the same frozen observation and are single-use', async () => {
  const clockState = clock()
  const obs = new SessionObservations('a1', clockState.now)
  const page = fakePage(stats())
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  // Replace the current observation with a genuinely paged capture.
  const hugePage = fakePage(stats(0, 100), {
    locator: () => ({ ariaSnapshot: async () => 'x'.repeat(CAPTURE_BOUND_BYTES / 4) }),
  })
  const tabId = obs.registerTab(hugePage)
  obs.setActiveTab(tabId)
  const big = await obs.capture({ agentId: 'a1', tabId, page: hugePage })
  expect(big.hasMore).toBe(true)

  const cursor = big.nextCursor
  expect(cursor).toBeTruthy()
  const second = obs.continue(cursor as string)
  expect(second.text.length).toBeGreaterThan(0)
  expect(second.observationId).toBe(big.observationId)
  obs.consume(cursor as string)
  // consumed: the cursor is single-use
  expect(() => obs.continue(cursor as string)).toThrow(ObservationExpiredError)
})

test('an expired cursor is refused', async () => {
  const clockState = clock()
  const obs = new SessionObservations('a1', clockState.now)
  const hugePage = fakePage(stats(), {
    locator: () => ({ ariaSnapshot: async () => 'x'.repeat(CAPTURE_BOUND_BYTES / 4) }),
  })
  const first = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page: hugePage })
  const cursor = first.nextCursor as string
  clockState.advance(5 * 60_000 + 1)
  expect(() => obs.continue(cursor)).toThrow(/expired/)
})

test('a stale observation (DOM changed) is refused and invalidates', async () => {
  const obs = new SessionObservations('a1')
  const mutable = { gen: 0 }
  const page = fakePage(stats(), {
    evaluate: async () => ({ docId: 'doc-1', generation: mutable.gen, nodes: 1, textChars: 10 }),
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  mutable.gen = 1 // the page mutated after capture
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('a navigation (new document) invalidates the observation', async () => {
  const obs = new SessionObservations('a1')
  let doc = 'doc-1'
  const page = fakePage(stats(), {
    evaluate: async () => ({ docId: doc, generation: 0, nodes: 1, textChars: 10 }),
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  doc = 'doc-2' // navigated: a new document identity
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
})

test('a cursor from another agent is refused', async () => {
  const clockState = clock()
  const obs = new SessionObservations('a1', clockState.now)
  const hugePage = fakePage(stats(), {
    locator: () => ({ ariaSnapshot: async () => 'x'.repeat(CAPTURE_BOUND_BYTES / 4) }),
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page: hugePage })
  // The same cursor store seen by agent-2 (cross-agent theft attempt).
  const other = Object.assign(obs, {})
  const cursor = firstCursor(other as SessionObservations)
  expect(() => other.continue(cursor)).not.toThrow()
  // A cursor presented to a DIFFERENT session's observations is unknown there.
  const foreign = new SessionObservations('a2', clockState.now)
  expect(() => foreign.continue(cursor)).toThrow(ObservationExpiredError)
})

function firstCursor(obs: SessionObservations): string {
  // Reach into the store via a formatted continuation chain: capture guarantees
  // at least one cursor when more text remains.
  const id = obs.getCurrentObservationId()
  expect(id).toBeTruthy()
  // re-format the current observation's chunk 0 by continuing from its stored cursor
  const cursor = (obs as unknown as { cursors: Map<string, { id: string }> }).cursors
    .keys()
    .next().value
  expect(cursor).toBeTruthy()
  return cursor as string
}

test('ref interactions require the current observationId', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats())
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(() => obs.requireCurrentObservation('forged-observation-id')).toThrow(
    ObservationExpiredError,
  )
  expect(() => obs.requireCurrentObservation(undefined)).toThrow(ObservationExpiredError)
})

test('tabs get stable session-local ids and closed tabs disappear', async () => {
  const obs = new SessionObservations('a1')
  let closed = false
  const page = fakePage(stats(), { isClosed: () => closed })
  expect(obs.registerTab(page)).toBe('tab-1')
  expect(obs.registerTab(page)).toBe('tab-1') // stable
  const second = fakePage(stats())
  expect(obs.registerTab(second)).toBe('tab-2')
  obs.setActiveTab('tab-2')

  const pages = [page, second]
  const list = obs.tabs(pages)
  expect(list.map((t) => t.tabId)).toEqual(['tab-1', 'tab-2'])
  expect(list.find((t) => t.tabId === 'tab-2')?.active).toBe(true)

  // tab closed: it disappears from the listing and its page is unresolvable
  closed = true
  expect(obs.pageForTab(pages, 'tab-1')).toBeNull()
  expect(obs.tabs(pages).map((t) => t.tabId)).toEqual(['tab-2'])
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('capture refuses Agent/tab labels that do not match the session', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats())
  const first = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(obs.capture({ agentId: 'a2', tabId: 'tab-1', page })).rejects.toThrow(
    ObservationExpiredError,
  )
  await expect(obs.capture({ agentId: 'a1', tabId: 'tab-2', page })).rejects.toThrow(
    ObservationExpiredError,
  )
  expect(obs.getCurrentObservationId()).toBe(first.observationId)
})

test('a different Page with matching forged stats cannot borrow observation authority', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats())
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(obs.assertFresh(fakePage(stats()))).rejects.toThrow(ObservationExpiredError)
})

test('capture freezes its canonical input before awaiting body attachment', async () => {
  const obs = new SessionObservations('a1')
  const entered = deferred()
  const release = deferred()
  const page = fakePage(stats(), {
    locator: () => ({
      waitFor: async () => {
        entered.resolve()
        await release.promise
      },
    }),
  })
  const input = { agentId: 'a1', tabId: 'tab-1', page }
  const pending = obs.capture(input)
  await entered.promise
  input.agentId = 'forged-agent'
  input.tabId = 'forged-tab'
  release.resolve()
  await pending
  const retained = (obs as unknown as { current: Observation }).current
  expect(retained.agentId).toBe('a1')
  expect(retained.tabId).toBe('tab-1')
})

test('DOM changes during ARIA serialization cannot publish fresh refs', async () => {
  const obs = new SessionObservations('a1')
  let gen = 0
  const page = fakePage(stats(), {
    evaluate: async () => stats(gen),
    locator: () => ({
      ariaSnapshot: async () => {
        gen++
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  await expect(obs.capture({ agentId: 'a1', tabId: 'tab-1', page })).rejects.toThrow(
    /changed while/,
  )
  expect(obs.getCurrentObservationId()).toBeNull()
  expect(obs.cursorCountForTest()).toBe(0)
})

test('mutable evaluator return objects cannot rewrite the pre-capture stamp', async () => {
  const obs = new SessionObservations('a1')
  const mutable = stats()
  const page = fakePage(mutable, {
    locator: () => ({
      ariaSnapshot: async () => {
        mutable.generation++
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  await expect(obs.capture({ agentId: 'a1', tabId: 'tab-1', page })).rejects.toThrow(
    /changed while/,
  )
  expect(obs.getCurrentObservationId()).toBeNull()
})

test('failed replacement capture consumes the old observation even without a DOM mutation', async () => {
  const obs = new SessionObservations('a1')
  let fail = false
  const page = fakePage(stats(), {
    locator: () => ({
      ariaSnapshot: async () => {
        if (fail) throw new Error('serialization failed')
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  const first = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  fail = true
  await expect(obs.capture({ agentId: 'a1', tabId: 'tab-1', page })).rejects.toThrow(
    'serialization failed',
  )
  expect(() => obs.requireCurrentObservation(first.observationId)).toThrow(ObservationExpiredError)
  expect(obs.getCurrentObservationId()).toBeNull()
})

test('invalidation while body attachment is pending prevents late publication', async () => {
  const obs = new SessionObservations('a1')
  const entered = deferred()
  const release = deferred()
  const page = fakePage(stats(), {
    locator: () => ({
      waitFor: async () => {
        entered.resolve()
        await release.promise
      },
    }),
  })
  const pending = obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await entered.promise
  obs.invalidate()
  release.resolve()
  await expect(pending).rejects.toThrow(/invalidated before publication/)
  expect(obs.getCurrentObservationId()).toBeNull()
})

test('an older capture cannot overwrite or invalidate a newer published observation', async () => {
  const obs = new SessionObservations('a1')
  const entered = deferred()
  const release = deferred()
  let calls = 0
  const page = fakePage(stats(), {
    locator: () => ({
      ariaSnapshot: async () => {
        if (++calls === 1) {
          entered.resolve()
          await release.promise
          return '- old'
        }
        return '- new'
      },
    }),
  })
  const pending = obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await entered.promise
  const newer = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  release.resolve()
  await expect(pending).rejects.toThrow(/invalidated before publication/)
  expect(obs.getCurrentObservationId()).toBe(newer.observationId)
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
})

test('tab switching during serialization cancels publication even after switching back', async () => {
  const obs = new SessionObservations('a1')
  const entered = deferred()
  const release = deferred()
  const page = fakePage(stats(), {
    locator: () => ({
      ariaSnapshot: async () => {
        entered.resolve()
        await release.promise
        return '- old'
      },
    }),
  })
  const pending = obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await entered.promise
  const other = obs.registerTab(fakePage(stats()))
  obs.setActiveTab(other)
  obs.setActiveTab('tab-1')
  release.resolve()
  await expect(pending).rejects.toThrow(/invalidated before publication/)
  expect(obs.getCurrentObservationId()).toBeNull()
})

test('same-document URL changes expire publication and existing refs', async () => {
  const obs = new SessionObservations('a1')
  let url = 'http://fixture.test/old'
  let mutate = false
  const page = fakePage(stats(), {
    url: () => url,
    locator: () => ({
      ariaSnapshot: async () => {
        if (mutate) url = 'http://fixture.test/new'
        return '- button "Reject" [ref=e1]'
      },
    }),
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  url = 'http://fixture.test/other'
  await expect(obs.assertFresh(page)).rejects.toThrow(ObservationExpiredError)
  mutate = true
  await expect(obs.capture({ agentId: 'a1', tabId: 'tab-1', page })).rejects.toThrow(
    /changed while/,
  )
  expect(obs.getCurrentObservationId()).toBeNull()
})

test('URL binding retains a fixed digest rather than the unbounded raw URL', async () => {
  const obs = new SessionObservations('a1')
  const url = `https://fixture.test/?q=${'x'.repeat(CAPTURE_BOUND_BYTES * 2)}`
  const page = fakePage(stats(), { url: () => url })
  const result = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  const retained = (obs as unknown as { current: Observation }).current
  expect(retained.urlDigest).toBe(createHash('sha256').update(url).digest('hex'))
  expect(retained.urlDigest).toHaveLength(64)
  expect(Object.values(retained)).not.toContain(url)
  expect(result.text).not.toContain(url)
  await expect(obs.assertFresh(page)).resolves.toBeUndefined()
})

test('invalidation during asynchronous freshness checks cannot return fresh', async () => {
  const obs = new SessionObservations('a1')
  const entered = deferred()
  const release = deferred()
  let hold = false
  const page = fakePage(stats(), {
    evaluate: async () => {
      if (hold) {
        entered.resolve()
        await release.promise
      }
      return stats()
    },
  })
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  hold = true
  const pending = obs.assertFresh(page)
  await entered.promise
  obs.invalidate()
  release.resolve()
  await expect(pending).rejects.toThrow(ObservationExpiredError)
})

test('capture rejects selector-shaped refs before any serialization', async () => {
  const obs = new SessionObservations('a1')
  const page = fakePage(stats())
  await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  await expect(
    obs.capture({ agentId: 'a1', tabId: 'tab-1', page, ref: 'e1 >> button' }),
  ).rejects.toThrow(/observed element ref/)
})

test('boundText caps action text at the response bound', () => {
  const small = 'ok'
  expect(boundText(small)).toBe(small)
  const huge = 'y'.repeat(100_000)
  const bounded = boundText(huge)
  expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(32_768)
  expect(bounded).toMatch(/truncated at the response bound/)
})

test('screenshots over the decoded bound are refused, never truncated', () => {
  // Craft a minimal PNG header: 8-byte signature + IHDR with 4000x3000.
  const png = Buffer.alloc(30)
  png.write('PNG', 1, 'ascii')
  png.write('IHDR', 12, 'ascii')
  png.writeUInt32BE(4000, 16)
  png.writeUInt32BE(3000, 20)
  expect(() => assertScreenshotWithinBound(png)).toThrow(/8 MiB/)
  // A viewport-sized screenshot is fine.
  const small = Buffer.alloc(30)
  small.write('PNG', 1, 'ascii')
  small.write('IHDR', 12, 'ascii')
  small.writeUInt32BE(1280, 16)
  small.writeUInt32BE(800, 20)
  expect(() => assertScreenshotWithinBound(small)).not.toThrow()
})

test('observation results fit the response bound with metadata included', async () => {
  const clockState = clock()
  const obs = new SessionObservations('a1', clockState.now)
  const page = fakePage(stats(), {
    locator: () => ({
      ariaSnapshot: async () =>
        Array.from({ length: 5000 }, (_, i) => `content line ${i} with padding`).join('\n'),
    }),
  })
  const first = await obs.capture({ agentId: 'a1', tabId: 'tab-1', page })
  expect(Buffer.byteLength(first.text, 'utf8')).toBeLessThanOrEqual(32_768)
  expect(first.hasMore).toBe(true)

  // Page through everything: every chunk fits, and the end is declared.
  let formatted: FormattedObservation | null = first
  let chunks = 1
  while (formatted?.nextCursor) {
    const next = obs.continue(formatted.nextCursor)
    obs.consume(formatted.nextCursor)
    expect(Buffer.byteLength(next.text, 'utf8')).toBeLessThanOrEqual(32_768)
    formatted = next
    chunks++
  }
  expect(formatted?.hasMore).toBe(false)
  expect(chunks).toBeGreaterThan(1)
})
