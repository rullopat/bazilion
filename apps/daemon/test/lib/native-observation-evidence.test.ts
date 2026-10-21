import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Page } from 'playwright'
import { expect, test, vi } from 'vitest'
import { NativeObservationReader } from '../../src/lib/browser/native-observation-evidence.ts'
import { ObservationExpiredError, SessionObservations } from '../../src/lib/browser/observation.ts'

function fixture(
  options: {
    huge?: boolean
    fail?: boolean
    hold?: boolean
    holdAttach?: boolean
    holdEnable?: boolean
    failEnable?: boolean
    holdDetach?: boolean
    failDetach?: boolean
    largePng?: boolean
    screenshotHook?: () => void
    captureHook?: () => void
    domValue?: () => string
    holdDomAt?: number
    holdStatsAt?: number
  } = {},
) {
  let detached = 0
  const commands: string[] = []
  let nativeReads = 0
  let statsReads = 0
  let enter!: () => void
  const entered = new Promise<void>((done) => {
    enter = done
  })
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const png = Buffer.alloc(30)
  png.write('IHDR', 12, 'ascii')
  png.writeUInt32BE(options.largePng ? 2000 : 100, 16)
  png.writeUInt32BE(options.largePng ? 2000 : 100, 20)
  const cdp = {
    detach: async () => {
      detached++
      if (options.failDetach) throw new Error('detach failed')
      if (options.holdDetach) await held
    },
    send: async (method: string) => {
      commands.push(method)
      if (detached) throw new Error('detached')
      if (method === 'Accessibility.enable') {
        if (options.failEnable) throw new Error('enable failed')
        if (options.holdEnable) await held
        return {}
      }
      if (method === 'DOMSnapshot.getSnapshot') {
        if (options.fail) throw new Error('unsupported')
        if (options.hold || ++nativeReads === options.holdDomAt) {
          enter()
          await held
        }
        return {
          domNodes: [
            {
              nodeValue: options.huge
                ? 'x'.repeat(5 * 1024 * 1024)
                : (options.domValue?.() ?? 'fixture'),
            },
          ],
          layoutTreeNodes: [],
          computedStyles: [],
        }
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] }
      if (method === 'Page.getLayoutMetrics') return {}
      if (method === 'Page.captureScreenshot') {
        options.screenshotHook?.()
        return { data: png.toString('base64') }
      }
      throw new Error('unexpected protocol call')
    },
  }
  const stamp = { docId: 'fixture-doc', generation: 0, nodes: 1, textChars: 20 }
  const locator = () => ({
    waitFor: async () => {},
    count: async () => 1,
    evaluate: async () => stamp,
    ariaSnapshot: async () => {
      options.captureHook?.()
      return '- button "Reject" [ref=e1]'
    },
  })
  const page = {
    isClosed: () => false,
    url: () => 'https://fixture.invalid/',
    evaluate: async () => {
      if (++statsReads === options.holdStatsAt) {
        enter()
        await held
      }
      return stamp
    },
    locator,
    getByRole: locator,
    context: () => ({
      newCDPSession: async () => {
        if (options.holdAttach) await held
        return cdp
      },
    }),
  } as unknown as Page
  return { page, commands, entered, detached: () => detached, release: () => release?.() }
}

test('native evidence retains only digest/counts and retired readers cannot be used again', async () => {
  const fake = fixture()
  const reader = await NativeObservationReader.create(fake.page)
  const result = await reader.read()
  expect(result.kind).toBe('captured')
  expect(Object.keys(result).sort()).toEqual([
    'bytes',
    'coherence',
    'coverage',
    'digest',
    'kind',
    'nodes',
  ])
  if (result.kind !== 'captured') throw new Error('missing synthetic evidence')
  expect(result.coverage).toBe('unqualified')
  expect(result.coherence).toBe('unqualified')
  expect(await reader.dispose()).toBe('detached')
  expect(fake.detached()).toBe(1)
  expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'retired' })
})

test('over-budget native state supplies no digest', async () => {
  const fake = fixture({ huge: true })
  const reader = await NativeObservationReader.create(fake.page)
  try {
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'over-budget' })
  } finally {
    await reader.dispose()
  }
})

test('unsupported native protocol never falls back to page evaluation', async () => {
  const fake = fixture({ fail: true })
  const reader = await NativeObservationReader.create(fake.page)
  try {
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'unavailable' })
  } finally {
    await reader.dispose()
  }
})

test('timed-out native measurement retires its session and cannot later supply evidence', async () => {
  vi.useFakeTimers()
  const fake = fixture({ hold: true })
  try {
    const reader = await NativeObservationReader.create(fake.page)
    const pending = reader.read()
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'unavailable' })
    await vi.advanceTimersByTimeAsync(2_001)
    expect(await pending).toEqual({ kind: 'unknown', reason: 'unavailable' })
    expect(fake.detached()).toBe(1)
    fake.release()
    await vi.advanceTimersByTimeAsync(1)
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'retired' })
  } finally {
    vi.useRealTimers()
  }
})

test('setup enable has a deadline and late completion cannot publish a reader', async () => {
  vi.useFakeTimers()
  const fake = fixture({ holdEnable: true })
  try {
    const pending = NativeObservationReader.create(fake.page)
    const refused = expect(pending).rejects.toThrow('setup deadline expired')
    await vi.advanceTimersByTimeAsync(2_001)
    await refused
    expect(fake.detached()).toBe(1)
    fake.release()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.detached()).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('sessions attached after setup expires are detached without enabling measurements', async () => {
  vi.useFakeTimers()
  const fake = fixture({ holdAttach: true })
  try {
    const refused = expect(NativeObservationReader.create(fake.page)).rejects.toThrow(
      'setup deadline expired',
    )
    await vi.advanceTimersByTimeAsync(2_001)
    await refused
    fake.release()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.detached()).toBe(1)
    expect(fake.commands).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test('setup failure does not wait indefinitely for failed cleanup', async () => {
  vi.useFakeTimers()
  const fake = fixture({ failEnable: true, holdDetach: true })
  try {
    await expect(NativeObservationReader.create(fake.page)).rejects.toThrow('enable failed')
    expect(fake.detached()).toBe(1)
    await vi.advanceTimersByTimeAsync(2_001)
    fake.release()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.detached()).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('concurrent cleanup shares a bounded uncertain outcome instead of claiming detachment', async () => {
  vi.useFakeTimers()
  const fake = fixture({ holdDetach: true })
  try {
    const reader = await NativeObservationReader.create(fake.page)
    const first = reader.dispose()
    expect(reader.dispose()).toBe(first)
    await vi.advanceTimersByTimeAsync(2_001)
    expect(await first).toBe('timed-out')
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'retired' })
    fake.release()
    await vi.advanceTimersByTimeAsync(1)
    expect(await reader.dispose()).toBe('timed-out')
    expect(fake.detached()).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

test('failed detachment is a shared failure, never a confirmed cleanup', async () => {
  const fake = fixture({ failDetach: true })
  const reader = await NativeObservationReader.create(fake.page)
  const first = reader.dispose()
  expect(reader.dispose()).toBe(first)
  expect(await first).toBe('failed')
  expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'retired' })
})

test('absolute expiry rejects evidence even when the timer callback has not executed', async () => {
  let elapsed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  const fake = fixture({
    screenshotHook: () => {
      elapsed = 2_100
    },
  })
  let reader: NativeObservationReader | undefined
  try {
    reader = await NativeObservationReader.create(fake.page)
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'unavailable' })
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'retired' })
  } finally {
    await reader?.dispose()
    vi.restoreAllMocks()
  }
})

test('diagnostic publication binds samples to the exact canonical observation and delivered text', async () => {
  const fake = fixture()
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  try {
    const result = await reader.capturePublicationCandidate(obs, {
      agentId: 'a1',
      tabId: 'tab-1',
      page: fake.page,
    })
    expect(result.evidence.observationId).toBe(result.observation.observationId)
    expect(result.evidence.agentId).toBe('a1')
    expect(result.evidence.tabId).toBe('tab-1')
    expect(result.evidence.deliveredTextDigest).toBe(
      createHash('sha256').update(result.observation.text).digest('hex'),
    )
    expect(obs.getCurrentObservationId()).toBe(result.observation.observationId)
    expect(result.evidence.sample.coverage).toBe('unqualified')
    expect(result.evidence.sample.coherence).toBe('unqualified')
    expect(Object.isFrozen(result.evidence)).toBe(true)
    expect(Object.isFrozen(result.evidence.sample)).toBe(true)
    expect(Object.isFrozen(result.observation)).toBe(true)
  } finally {
    await reader.dispose()
  }
})

test('native publication rejects foreign Page/Agent/tab before reading any sample', async () => {
  const fake = fixture()
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  try {
    for (const input of [
      { agentId: 'a2', tabId: 'tab-1', page: fake.page },
      { agentId: 'a1', tabId: 'tab-2', page: fake.page },
      { agentId: 'a1', tabId: 'tab-1', page: fixture().page },
    ])
      await expect(reader.capturePublicationCandidate(obs, input)).rejects.toThrow(
        ObservationExpiredError,
      )
    expect(fake.commands).toEqual(['Accessibility.enable'])
  } finally {
    await reader.dispose()
  }
})

test('native drift after ARIA capture drops the publication instead of rebasing its evidence', async () => {
  let value = 'before'
  const fake = fixture({
    domValue: () => value,
    captureHook: () => {
      value = 'after'
    },
  })
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  try {
    await expect(
      reader.capturePublicationCandidate(obs, { agentId: 'a1', tabId: 'tab-1', page: fake.page }),
    ).rejects.toThrow(/native state changed/)
    expect(obs.getCurrentObservationId()).toBeNull()
  } finally {
    await reader.dispose()
  }
})

test('a late native publication cannot replace or invalidate a newer canonical capture', async () => {
  const fake = fixture({ holdDomAt: 2 })
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  const input = { agentId: 'a1', tabId: 'tab-1', page: fake.page }
  try {
    const pending = reader.capturePublicationCandidate(obs, input)
    await fake.entered
    const newer = await obs.capture(input)
    fake.release()
    await expect(pending).rejects.toThrow(ObservationExpiredError)
    expect(obs.getCurrentObservationId()).toBe(newer.observationId)
    await expect(obs.assertFresh(fake.page)).resolves.toBeUndefined()
  } finally {
    fake.release()
    await reader.dispose()
  }
})

test('ref-scoped native sampling cannot borrow a newer observation after its initial read', async () => {
  const fake = fixture({ holdDomAt: 1 })
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  const input = { agentId: 'a1', tabId: 'tab-1', page: fake.page }
  try {
    await obs.capture(input)
    const pending = reader.capturePublicationCandidate(obs, { ...input, ref: 'e1' })
    await fake.entered
    const newer = await obs.capture(input)
    fake.release()
    await expect(pending).rejects.toThrow(ObservationExpiredError)
    expect(obs.getCurrentObservationId()).toBe(newer.observationId)
  } finally {
    fake.release()
    await reader.dispose()
  }
})

test('invalidation during native post-publication reads prevents an evidence receipt', async () => {
  const fake = fixture({ holdDomAt: 2 })
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  try {
    const pending = reader.capturePublicationCandidate(obs, {
      agentId: 'a1',
      tabId: 'tab-1',
      page: fake.page,
    })
    await fake.entered
    obs.invalidate()
    fake.release()
    await expect(pending).rejects.toThrow(ObservationExpiredError)
    expect(obs.getCurrentObservationId()).toBeNull()
  } finally {
    fake.release()
    await reader.dispose()
  }
})

test('retirement during final legacy freshness cannot return a native publication candidate', async () => {
  const fake = fixture({ holdStatsAt: 3 })
  const reader = await NativeObservationReader.create(fake.page)
  const obs = new SessionObservations('a1')
  try {
    const pending = reader.capturePublicationCandidate(obs, {
      agentId: 'a1',
      tabId: 'tab-1',
      page: fake.page,
    })
    await fake.entered
    await reader.dispose()
    fake.release()
    await expect(pending).rejects.toThrow(/reader retired/)
    expect(obs.getCurrentObservationId()).toBeNull()
  } finally {
    fake.release()
    await reader.dispose()
  }
})

for (const scope of [undefined, 'dialog'] as const) {
  for (const change of ['newer', 'invalidate', 'tab-switch-back'] as const) {
    test(`first native read lease rejects ${change} for ${scope ?? 'unscoped'} capture`, async () => {
      const fake = fixture({ holdDomAt: 1 })
      const reader = await NativeObservationReader.create(fake.page)
      const obs = new SessionObservations('a1')
      const input = { agentId: 'a1', tabId: 'tab-1', page: fake.page }
      try {
        // Start with no published observation: a null-id comparison alone
        // would not detect invalidate or a switch-away-and-back.
        const pending = reader.capturePublicationCandidate(obs, { ...input, scope })
        await fake.entered
        let newerId: string | null = null
        if (change === 'newer') newerId = (await obs.capture(input)).observationId
        else if (change === 'invalidate') obs.invalidate()
        else {
          const other = obs.registerTab(fixture().page)
          obs.setActiveTab(other)
          obs.setActiveTab('tab-1')
        }
        fake.release()
        await expect(pending).rejects.toThrow(/invalidated before publication/)
        expect(obs.getCurrentObservationId()).toBe(newerId)
      } finally {
        fake.release()
        await reader.dispose()
      }
    })
  }
}

test('decoded screenshot overflow is classified as over-budget', async () => {
  const fake = fixture({ largePng: true })
  const reader = await NativeObservationReader.create(fake.page)
  try {
    expect(await reader.read()).toEqual({ kind: 'unknown', reason: 'over-budget' })
  } finally {
    await reader.dispose()
  }
})
