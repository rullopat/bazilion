import type { CodingCommandState } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  CODING_LOG_BYTES,
  CODING_LOG_TTL_MS,
  deleteCodingCommandLog,
  getCodingCommandLog,
  pruneCodingCommandLogs,
  readCodingCommandLog,
  releaseCodingCommandLog,
  saveCodingCommandLog,
  searchCodingCommandLog,
} from '../../src/core/repos/coding-command-logs.ts'
import { saveCodingCommand } from '../../src/core/repos/coding-commands.ts'
import {
  CODING_OUTPUT_BYTES,
  CODING_RETAINED_BYTES,
  CodingDiagnostics,
  diagnosticTail,
} from '../../src/lib/coding-environment/diagnostics.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let seq = 0

function seedCommand(env: TestEnv, state: CodingCommandState = 'succeeded') {
  const id = `command-${++seq}`
  const now = Date.now()
  saveCodingCommand(env.db, {
    id,
    agentId: 'agent-1',
    teamId: env.teamId,
    turnId: `turn-${seq}`,
    toolCallId: `call-${seq}`,
    input: { command: 'pnpm test', cwd: '.', purpose: 'test', timeoutSeconds: 60 },
    environment: {
      posture: 'docker',
      imageId: 'sha256:abc',
      cwd: '.',
      rootIdentity: 'root-1',
      inputFingerprint: 'fingerprint-1',
      capturedAt: now,
      restrictions: [],
    },
    startedAt: now,
    finishedAt: now,
    state,
    exitCode: 0,
    diagnostic: '',
    truncated: false,
    reason: null,
  })
  return id
}

function retain(
  env: TestEnv,
  commandId: string,
  diagnostic: string,
  overrides: { observedBytes?: number; redacted?: boolean; truncated?: boolean; now?: number } = {},
) {
  return saveCodingCommandLog(env.db, {
    commandId,
    teamId: env.teamId,
    agentId: 'agent-1',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    diagnostic,
    observedBytes: overrides.observedBytes ?? Buffer.byteLength(diagnostic),
    redacted: overrides.redacted ?? false,
    truncated: overrides.truncated ?? false,
    now: overrides.now,
  })
}

// --- Tier 1: redaction and retention in the collector, no database ---

test('redacts a credential split across two output chunks', () => {
  const diagnostics = new CodingDiagnostics(['super-secret-token'])
  diagnostics.append(Buffer.from('before super-sec'))
  diagnostics.append(Buffer.from('ret-token after'))
  const result = diagnostics.finish()
  expect(result.diagnostic).toBe('before [redacted] after')
  expect(result.redacted).toBe(true)
})

test('reports no redaction when nothing matched', () => {
  const diagnostics = new CodingDiagnostics(['super-secret-token'])
  diagnostics.append(Buffer.from('ordinary output'))
  const result = diagnostics.finish()
  expect(result.diagnostic).toBe('ordinary output')
  expect(result.redacted).toBe(false)
})

test('observed bytes count what was produced, not what was retained', () => {
  const diagnostics = new CodingDiagnostics([], 1024)
  const chunk = 'x'.repeat(4096)
  diagnostics.append(Buffer.from(chunk))
  diagnostics.append(Buffer.from(chunk))
  const result = diagnostics.finish()
  expect(result.observedBytes).toBe(8192)
  expect(Buffer.byteLength(result.diagnostic)).toBeLessThanOrEqual(1024)
  expect(result.truncated).toBe(true)
})

test('the receipt tail stays at 64 KiB while the log retention is larger', () => {
  expect(CODING_RETAINED_BYTES).toBeGreaterThan(CODING_OUTPUT_BYTES)
  const diagnostics = new CodingDiagnostics([], CODING_RETAINED_BYTES)
  diagnostics.append(Buffer.from('y'.repeat(200 * 1024)))
  const retained = diagnostics.finish()
  // The collector kept the full input, but the receipt's derived tail is still bounded.
  expect(Buffer.byteLength(retained.diagnostic)).toBe(200 * 1024)
  expect(retained.truncated).toBe(false)
  const tail = diagnosticTail(retained.diagnostic, CODING_OUTPUT_BYTES)
  expect(Buffer.byteLength(tail.text)).toBeLessThanOrEqual(CODING_OUTPUT_BYTES)
  expect(tail.truncated).toBe(true)
})

test('diagnostic tails never split a multibyte codepoint', () => {
  const value = '→'.repeat(100)
  const tail = diagnosticTail(value, 10)
  expect(tail.truncated).toBe(true)
  expect(tail.text).not.toContain('\uFFFD')
  expect(Buffer.byteLength(tail.text)).toBeLessThanOrEqual(10)
})

// --- Tier 2: the availability state machine ---

test('a retained log round-trips and reports available', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const view = retain(env, commandId, 'all tests passed')
    expect(view.availability).toBe('available')
    expect(view.observedBytes).toBe(Buffer.byteLength('all tests passed'))
    const page = readCodingCommandLog(env.db, commandId, { audience: 'producer' }, view.createdAt)
    expect(page?.text).toBe('all tests passed')
    expect(page?.hasMore).toBe(false)
  } finally {
    env.cleanup()
  }
})

test('output larger than the per-command cap reports truncated', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const view = retain(env, commandId, 'z'.repeat(4096), { observedBytes: 999999 })
    expect(view.availability).toBe('truncated')
    expect(view.byteLength).toBe(4096)
    expect(view.observedBytes).toBe(999999)
  } finally {
    env.cleanup()
  }
})

test('a worker-side truncation never describes the retained tail as complete', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    // Exactly the retained length, but the producer said it had already dropped bytes.
    const view = retain(env, commandId, 'abc', { observedBytes: 3, truncated: true })
    expect(view.availability).toBe('truncated')
    // The explicit incident flag carries the truncation even when nothing shrank.
    expect(view.observedBytes).toBe(3)
  } finally {
    env.cleanup()
  }
})

test('expiry clears the bytes and leaves a truthful tombstone', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const base = Date.now()
    retain(env, commandId, 'failure detail', { now: base })
    pruneCodingCommandLogs(env.db, base + CODING_LOG_TTL_MS + 1)
    const view = getCodingCommandLog(env.db, commandId, base + CODING_LOG_TTL_MS + 1)
    expect(view.availability).toBe('expired')
    expect(view.byteLength).toBe(0)
    // The original observation survives, so expiry is distinguishable from never-captured.
    expect(view.observedBytes).toBe(Buffer.byteLength('failure detail'))
    expect(view.retiredAt).not.toBeNull()
  } finally {
    env.cleanup()
  }
})

test('reads report expiry even when no prune has run yet', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const base = Date.now()
    retain(env, commandId, 'stale detail', { now: base })
    const later = base + CODING_LOG_TTL_MS + 1
    const view = getCodingCommandLog(env.db, commandId, later)
    expect(view.availability).toBe('expired')
    const page = readCodingCommandLog(env.db, commandId, { audience: 'producer' }, later)
    expect(page?.text).toBe('')
  } finally {
    env.cleanup()
  }
})

test('deletion leaves a tombstone distinct from absence', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const view = retain(env, commandId, 'detail')
    deleteCodingCommandLog(env.db, commandId, view.createdAt + 10)
    const deleted = getCodingCommandLog(env.db, commandId, view.createdAt + 10)
    expect(deleted.availability).toBe('deleted')
    expect(deleted.byteLength).toBe(0)
    // A command that never retained anything is unavailable, not deleted.
    const absent = getCodingCommandLog(env.db, 'never-existed')
    expect(absent.availability).toBe('unavailable')
  } finally {
    env.cleanup()
  }
})

test('deletion supersedes an expired tombstone', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const base = Date.now()
    retain(env, commandId, 'detail', { now: base })
    pruneCodingCommandLogs(env.db, base + CODING_LOG_TTL_MS + 1)
    deleteCodingCommandLog(env.db, commandId, base + CODING_LOG_TTL_MS + 2)
    const view = getCodingCommandLog(env.db, commandId, base + CODING_LOG_TTL_MS + 2)
    expect(view.availability).toBe('deleted')
  } finally {
    env.cleanup()
  }
})

test('a re-save does not extend the retention window', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const base = Date.now()
    const first = retain(env, commandId, 'first chunk', { now: base })
    const second = retain(env, commandId, 'first chunk plus more', { now: base + 60_000 })
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.expiresAt).toBe(first.expiresAt)
    expect(second.byteLength).toBe(Buffer.byteLength('first chunk plus more'))
  } finally {
    env.cleanup()
  }
})

// --- Tier 2b: the egress boundary ---

test('disclosure reads refuse bytes that source-owned egress has not released', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'held output')
    expect(readCodingCommandLog(env.db, commandId, { audience: 'disclosure' })).toBeNull()
    expect(searchCodingCommandLog(env.db, commandId, 'held', { audience: 'disclosure' })).toBeNull()
    // The producing Agent is not gated; the hold only covers disclosure.
    expect(readCodingCommandLog(env.db, commandId, { audience: 'producer' })?.text).toBe(
      'held output',
    )
  } finally {
    env.cleanup()
  }
})

test('releasing captured bytes opens the disclosure path', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const view = retain(env, commandId, 'shareable output')
    releaseCodingCommandLog(env.db, commandId, view.createdAt + 5)
    const page = readCodingCommandLog(env.db, commandId, { audience: 'disclosure' })
    expect(page?.text).toBe('shareable output')
    expect(getCodingCommandLog(env.db, commandId).releasedAt).toBe(view.createdAt + 5)
  } finally {
    env.cleanup()
  }
})

test('changed output cannot inherit an earlier release', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const base = Date.now()
    retain(env, commandId, 'original bytes', { now: base })
    releaseCodingCommandLog(env.db, commandId, base + 1)
    retain(env, commandId, 'different bytes', { now: base + 2 })
    expect(readCodingCommandLog(env.db, commandId, { audience: 'disclosure' })).toBeNull()
  } finally {
    env.cleanup()
  }
})

// --- Tier 3: retention mechanics ---

test('quota eviction removes the oldest logs first', () => {
  const env = makeTestEnv()
  try {
    const base = Date.now()
    const first = seedCommand(env)
    const second = seedCommand(env)
    const third = seedCommand(env)
    const payload = 'q'.repeat(1000)
    retain(env, first, payload, { now: base })
    retain(env, second, payload, { now: base + 1 })
    retain(env, third, payload, { now: base + 2 })
    // 3000 retained against a 1500 budget: evict oldest until it fits.
    pruneCodingCommandLogs(env.db, base + 3, 1500)
    expect(getCodingCommandLog(env.db, first).availability).toBe('unavailable')
    expect(getCodingCommandLog(env.db, second).availability).toBe('unavailable')
    expect(getCodingCommandLog(env.db, third).availability).toBe('available')
  } finally {
    env.cleanup()
  }
})

test('quota eviction never removes the log of a running command', () => {
  const env = makeTestEnv()
  try {
    const base = Date.now()
    const running = seedCommand(env, 'running')
    const second = seedCommand(env)
    const third = seedCommand(env)
    const payload = 'r'.repeat(1000)
    retain(env, running, payload, { now: base })
    retain(env, second, payload, { now: base + 1 })
    retain(env, third, payload, { now: base + 2 })
    // The oldest log belongs to a running command, so the next-oldest is evicted instead.
    pruneCodingCommandLogs(env.db, base + 3, 2500)
    expect(getCodingCommandLog(env.db, running).availability).toBe('available')
    expect(getCodingCommandLog(env.db, second).availability).toBe('unavailable')
    expect(getCodingCommandLog(env.db, third).availability).toBe('available')
  } finally {
    env.cleanup()
  }
})

test('deleting the receipt removes its retained log', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'detail')
    env.db.raw.run('DELETE FROM coding_commands WHERE id = ?', [commandId])
    expect(getCodingCommandLog(env.db, commandId).availability).toBe('unavailable')
  } finally {
    env.cleanup()
  }
})

// --- Tier 4: bounds ---

test('read pages never split a codepoint at either edge', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'a→b→c')
    // Byte layout: a(1) →(3) b(1) →(3) c(1). A limit of 2 ends inside the first arrow.
    const first = readCodingCommandLog(env.db, commandId, {
      offset: 0,
      limit: 2,
      audience: 'producer',
    })
    expect(first?.text).toBe('a→')
    expect(first?.text).not.toContain('\uFFFD')
    // An offset inside the arrow rounds forward to the next lead byte.
    const second = readCodingCommandLog(env.db, commandId, {
      offset: 2,
      limit: 99,
      audience: 'producer',
    })
    expect(second?.offset).toBe(4)
    expect(second?.text).toBe('b→c')
    expect(second?.text).not.toContain('\uFFFD')
  } finally {
    env.cleanup()
  }
})

test('a page that stops short of the tail reports hasMore', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'abcdefghij')
    const page = readCodingCommandLog(env.db, commandId, {
      offset: 0,
      limit: 4,
      audience: 'producer',
    })
    expect(page?.text).toBe('abcd')
    expect(page?.hasMore).toBe(true)
    expect(page?.byteLength).toBe(10)
  } finally {
    env.cleanup()
  }
})

test('retention never exceeds the per-command cap', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    const view = retain(env, commandId, 'k'.repeat(CODING_LOG_BYTES + 5000), {
      observedBytes: CODING_LOG_BYTES + 5000,
    })
    expect(view.byteLength).toBe(CODING_LOG_BYTES)
    expect(view.availability).toBe('truncated')
  } finally {
    env.cleanup()
  }
})

test('search stops at the hit limit and reports bounded', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'needle '.repeat(200))
    const result = searchCodingCommandLog(env.db, commandId, 'needle', { audience: 'producer' })
    expect(result?.matches.length).toBe(50)
    expect(result?.bounded).toBe(true)
    expect(result?.matches[0]?.line).toBe(1)
  } finally {
    env.cleanup()
  }
})

test('search reports matches with offsets and line numbers', () => {
  const env = makeTestEnv()
  try {
    const commandId = seedCommand(env)
    retain(env, commandId, 'alpha\nbeta\ngamma-error\ndelta')
    const result = searchCodingCommandLog(env.db, commandId, 'error', { audience: 'producer' })
    expect(result?.matches.length).toBe(1)
    expect(result?.matches[0]?.line).toBe(3)
    expect(result?.bounded).toBe(false)
    expect(result?.matches[0]?.excerpt).toContain('gamma-error')
  } finally {
    env.cleanup()
  }
})
