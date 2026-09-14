import { expect, test } from 'vitest'
import {
  getSourceSnapshot,
  listSourceSnapshots,
  pruneSourceSnapshots,
  SOURCE_SNAPSHOT_TTL_MS,
  type SourceSnapshotInput,
  saveSourceSnapshot,
} from '../../src/core/repos/source-snapshots.ts'
import { makeTestEnv } from './helpers.ts'

// BAZ-042 slice 4b: the narrow durable store for bounded source snapshots.

function input(overrides: Partial<SourceSnapshotInput> = {}): SourceSnapshotInput {
  return {
    snapshotId: 'snap-a',
    teamId: '',
    capturedBy: 'agent',
    agentId: 'agent-1',
    turnId: 'turn-1',
    toolCallId: 'call-1',
    complete: true,
    head: 'head-oid',
    baseOid: 'base-oid',
    entryCount: 2,
    capturedContentBytes: 128,
    manifestJson: '{"entries":[]}',
    ...overrides,
  }
}

test('a snapshot round-trips with its provenance and window', () => {
  const env = makeTestEnv()
  try {
    const now = 1_000_000
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, now }))
    const record = getSourceSnapshot(env.db, env.teamId, 'snap-a', now)
    expect(record).toMatchObject({
      snapshotId: 'snap-a',
      teamId: env.teamId,
      agentId: 'agent-1',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      complete: true,
      head: 'head-oid',
      baseOid: 'base-oid',
      entryCount: 2,
      capturedContentBytes: 128,
      createdAt: now,
      expiresAt: now + SOURCE_SNAPSHOT_TTL_MS,
    })
  } finally {
    env.cleanup()
  }
})

test('re-capturing the same state keeps the first provenance and never extends the window', () => {
  const env = makeTestEnv()
  try {
    const first = 1_000_000
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, now: first }))
    // The id is content-addressed, so an identical capture collides on the same row.
    saveSourceSnapshot(
      env.db,
      input({
        teamId: env.teamId,
        now: first + 86_400_000,
        agentId: 'agent-2',
        turnId: 'turn-2',
        toolCallId: 'call-2',
      }),
    )
    const record = getSourceSnapshot(env.db, env.teamId, 'snap-a', first + 1)
    expect(record).toMatchObject({
      agentId: 'agent-1',
      turnId: 'turn-1',
      createdAt: first,
      expiresAt: first + SOURCE_SNAPSHOT_TTL_MS,
    })
  } finally {
    env.cleanup()
  }
})

test('an expired snapshot is absent rather than served as evidence', () => {
  const env = makeTestEnv()
  try {
    const now = 1_000_000
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, now }))
    const past = now + SOURCE_SNAPSHOT_TTL_MS
    expect(getSourceSnapshot(env.db, env.teamId, 'snap-a', past - 1)).not.toBeNull()
    // Both "never captured" and "past its window" must read the same way: applicability unknown.
    expect(getSourceSnapshot(env.db, env.teamId, 'snap-a', past)).toBeNull()
    expect(listSourceSnapshots(env.db, env.teamId, 50, past)).toEqual([])
    expect(pruneSourceSnapshots(env.db, past)).toBe(1)
  } finally {
    env.cleanup()
  }
})

test('a snapshot reference is meaningless outside its Team', () => {
  const env = makeTestEnv()
  try {
    const now = 1_000_000
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, now }))
    expect(getSourceSnapshot(env.db, 'another-team', 'snap-a', now)).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('saving an incomplete snapshot never widens what is treated as exact', () => {
  const env = makeTestEnv()
  try {
    const now = 1_000_000
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, now, complete: false }))
    expect(getSourceSnapshot(env.db, env.teamId, 'snap-a', now)?.complete).toBe(false)
  } finally {
    env.cleanup()
  }
})

test('the store refuses an over-bound manifest instead of truncating it', () => {
  const env = makeTestEnv()
  try {
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1)
    expect(() =>
      saveSourceSnapshot(env.db, input({ teamId: env.teamId, manifestJson: oversized })),
    ).toThrow()
    expect(getSourceSnapshot(env.db, env.teamId, 'snap-a')).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('listing is newest-first and Team-scoped', () => {
  const env = makeTestEnv()
  try {
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, snapshotId: 'older', now: 1_000 }))
    saveSourceSnapshot(env.db, input({ teamId: env.teamId, snapshotId: 'newer', now: 2_000 }))
    expect(
      listSourceSnapshots(env.db, env.teamId, 50, 3_000).map((record) => record.snapshotId),
    ).toEqual(['newer', 'older'])
  } finally {
    env.cleanup()
  }
})
