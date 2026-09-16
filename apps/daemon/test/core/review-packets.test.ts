import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  addReviewFinding,
  claimReviewAttempt,
  createReviewPacket,
  finishReviewAttempt,
  getReviewPacket,
  listDispatchableReviewPackets,
  listReviewAttempts,
  listReviewConclusions,
  listReviewFindings,
  pruneReviewPackets,
  ReviewPacketError,
  recordReviewConclusion,
  recoverInterruptedReviewAttempts,
  resolveReviewFinding,
} from '../../src/core/repos/review-packets.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slice 1: the packet, findings and conclusion model.
//
// The rules under test are the ones a code review cannot get wrong: the captured revision is immutable,
// a finding cannot be resolved by assumption, and exactly one owner reviews a packet.

function seed(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer']) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, teamId],
    )
  }
}

function packetEnv(): TestEnv {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  return env
}

function packetFor(env: TestEnv, overrides: Record<string, unknown> = {}) {
  return createReviewPacket(env.db, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    reviewerAgentId: 'reviewer',
    snapshotId: 'snap-1',
    snapshotComplete: true,
    head: 'head-oid',
    baseOid: 'base-oid',
    summary: 'the fix for the reported crash',
    ...overrides,
  })
}

test('a packet binds one captured revision and reads back unchanged', () => {
  const env = packetEnv()
  try {
    const created = packetFor(env)
    // Read by id and by team, both scoped to the retention window.
    expect(getReviewPacket(env.db, created.id)).toMatchObject({
      snapshotId: 'snap-1',
      snapshotComplete: true,
      state: 'open',
      requesterKind: 'agent',
      requesterAgentId: 'coder',
      reviewerAgentId: 'reviewer',
    })
    expect(created.expiresAt).toBeGreaterThan(created.createdAt)
    // Nothing captured yet: an export is a fact with evidence, not a default.
    expect(created.exportedAt).toBeNull()
    expect(created.exportRevision).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('an operator-only packet has no reviewer, and a self-review is refused by the schema', () => {
  const env = packetEnv()
  try {
    const operatorPacket = createReviewPacket(env.db, {
      teamId: env.teamId,
      requesterKind: 'operator',
      reviewerAgentId: null,
      snapshotId: 'snap-2',
      snapshotComplete: true,
      head: null,
      baseOid: 'base-oid',
    })
    expect(operatorPacket.requesterAgentId).toBeNull()
    // Nothing is delegated for an operator-only packet, so it is never dispatched.
    expect(listDispatchableReviewPackets(env.db).map((packet) => packet.id)).not.toContain(
      operatorPacket.id,
    )
    // An agent packet always names its requester, and never its own reviewer.
    expect(() => packetFor(env, { requesterAgentId: 'reviewer' })).toThrow()
  } finally {
    env.cleanup()
  }
})

test('findings are append-only and keep the revision they were made against', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    const first = addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'operator',
      path: 'src/app.ts',
      severity: 'major',
      note: 'this path is not covered by a test',
      lineStart: 12,
      lineEnd: 20,
      snapshotId: packet.snapshotId,
    })
    const second = addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'agent',
      authorAgentId: 'reviewer',
      path: 'src/other.ts',
      severity: 'info',
      note: 'naming',
      snapshotId: packet.snapshotId,
    })
    const listed = listReviewFindings(env.db, packet.id)
    expect(listed.map((finding) => finding.id)).toEqual([first.id, second.id])
    expect(listed[0]).toMatchObject({
      authorKind: 'operator',
      authorAgentId: null,
      state: 'open',
      snapshotId: packet.snapshotId,
      lineStart: 12,
      lineEnd: 20,
    })
    // A line end without a start is meaningless context and is refused by the database.
    expect(() =>
      addReviewFinding(env.db, {
        packetId: packet.id,
        authorKind: 'operator',
        path: 'src/app.ts',
        severity: 'minor',
        note: 'x',
        lineEnd: 4,
        snapshotId: packet.snapshotId,
      }),
    ).toThrow()
  } finally {
    env.cleanup()
  }
})

test('an unverified finding cannot be resolved, and resolution needs proof', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    const unverified = addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'agent',
      authorAgentId: 'reviewer',
      path: 'src/gone.ts',
      severity: 'major',
      note: 'could not be correlated to the reviewed revision',
      snapshotId: packet.snapshotId,
      state: 'unverified',
    })
    expect(() =>
      resolveReviewFinding(env.db, {
        findingId: unverified.id,
        resolutionKind: 'explicit',
        resolutionNote: 'looks fine',
        resolvedByKind: 'operator',
      }),
    ).toThrow(/never correlated/)
    // An empty note is not a decision.
    const open = addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'operator',
      path: 'src/app.ts',
      severity: 'blocker',
      note: 'the crash is still reachable',
      snapshotId: packet.snapshotId,
    })
    expect(() =>
      resolveReviewFinding(env.db, {
        findingId: open.id,
        resolutionKind: 'explicit',
        resolutionNote: '   ',
        resolvedByKind: 'operator',
      }),
    ).toThrow(/needs a note/)
    // A named later revision is a legitimate proof.
    const resolved = resolveReviewFinding(env.db, {
      findingId: open.id,
      resolutionKind: 'linked_revision',
      resolutionNote: 'fixed in the follow-up revision',
      resolvedByKind: 'operator',
    })
    expect(resolved).toMatchObject({
      state: 'resolved',
      resolutionKind: 'linked_revision',
      resolvedByAgentId: null,
    })
    expect(resolved.resolvedAt).toBeGreaterThan(0)
    // Resolving twice is refused rather than silently rewriting the decision.
    expect(() =>
      resolveReviewFinding(env.db, {
        findingId: open.id,
        resolutionKind: 'explicit',
        resolutionNote: 'again',
        resolvedByKind: 'operator',
      }),
    ).toThrow(/already resolved/)
  } finally {
    env.cleanup()
  }
})

test('a reviewer has one conclusion, and a later revision cannot inherit it', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    recordReviewConclusion(env.db, {
      packetId: packet.id,
      reviewerKind: 'agent',
      reviewerAgentId: 'reviewer',
      conclusion: 'commented',
      note: 'first pass',
      snapshotId: packet.snapshotId,
    })
    recordReviewConclusion(env.db, {
      packetId: packet.id,
      reviewerKind: 'agent',
      reviewerAgentId: 'reviewer',
      conclusion: 'changes_requested',
      note: 'blocker found',
      snapshotId: packet.snapshotId,
    })
    recordReviewConclusion(env.db, {
      packetId: packet.id,
      reviewerKind: 'operator',
      conclusion: 'recommended',
      snapshotId: packet.snapshotId,
    })
    const conclusions = listReviewConclusions(env.db, packet.id)
    // One per reviewer, replaced in place rather than appended as a history.
    expect(conclusions).toHaveLength(2)
    const reviewerConclusion = conclusions.find((entry) => entry.reviewerKind === 'agent')
    expect(reviewerConclusion).toMatchObject({
      conclusion: 'changes_requested',
      note: 'blocker found',
      snapshotId: packet.snapshotId,
    })
    // The operator's own conclusion is a separate fact, not a promotion of the reviewer's.
    expect(conclusions.find((entry) => entry.reviewerKind === 'operator')).toMatchObject({
      conclusion: 'recommended',
      reviewerAgentId: null,
    })
  } finally {
    env.cleanup()
  }
})

test('exactly one owner reviews a packet, and an interrupted claim is never replayed', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    const claimed = claimReviewAttempt(env.db, {
      packetId: packet.id,
      leaseOwner: 'owner-1',
      leaseMs: 1_000,
      now: 1_000,
    })
    expect(claimed?.attempt).toMatchObject({ state: 'claimed', attemptNumber: 1 })
    expect(getReviewPacket(env.db, packet.id, 1_000)?.state).toBe('reviewing')
    // A second claim cannot open while one is open.
    expect(
      claimReviewAttempt(env.db, {
        packetId: packet.id,
        leaseOwner: 'owner-2',
        leaseMs: 1_000,
        now: 1_500,
      }),
    ).toBeNull()

    // The daemon restarts; the lease expires and the attempt becomes uncertain, not replayable.
    expect(recoverInterruptedReviewAttempts(env.db, 5_000)).toBe(1)
    expect(listReviewAttempts(env.db, packet.id)[0]).toMatchObject({ state: 'uncertain' })
    expect(getReviewPacket(env.db, packet.id, 5_000)?.state).toBe('open')
    expect(
      listReviewAttempts(env.db, packet.id).every((attempt) => attempt.finishedAt !== null),
    ).toBe(true)

    // Only an explicit new attempt reviews it again, and it links the result it supersedes.
    const retried = claimReviewAttempt(env.db, {
      packetId: packet.id,
      leaseOwner: 'owner-3',
      leaseMs: 1_000,
      now: 6_000,
      supersedes: listReviewAttempts(env.db, packet.id)[0]?.id ?? null,
    })
    expect(retried?.attempt).toMatchObject({ attemptNumber: 2, state: 'claimed' })
    // A mismatched owner cannot finish another owner's attempt.
    expect(
      finishReviewAttempt(env.db, {
        attemptId: retried?.attempt.id ?? '',
        leaseOwner: 'someone-else',
        state: 'completed',
      }),
    ).toBe(false)
    expect(
      finishReviewAttempt(env.db, {
        attemptId: retried?.attempt.id ?? '',
        leaseOwner: 'owner-3',
        state: 'completed',
      }),
    ).toBe(true)
    expect(getReviewPacket(env.db, packet.id, 6_000)?.state).toBe('reviewed')
  } finally {
    env.cleanup()
  }
})

test('a failed reviewer turn leaves the packet open rather than reporting a review', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    const claimed = claimReviewAttempt(env.db, {
      packetId: packet.id,
      leaseOwner: 'owner',
      leaseMs: 1_000,
    })
    finishReviewAttempt(env.db, {
      attemptId: claimed?.attempt.id ?? '',
      leaseOwner: 'owner',
      state: 'failed',
      error: 'the review turn failed',
    })
    // Not `reviewed`: nothing was reviewed, so the packet waits for a decision instead of claiming one.
    expect(getReviewPacket(env.db, packet.id)?.state).toBe('open')
  } finally {
    env.cleanup()
  }
})

test('retention removes a packet past its window with everything attached to it', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'operator',
      path: 'src/app.ts',
      severity: 'minor',
      note: 'x',
      snapshotId: packet.snapshotId,
    })
    recordReviewConclusion(env.db, {
      packetId: packet.id,
      reviewerKind: 'operator',
      conclusion: 'commented',
      snapshotId: packet.snapshotId,
    })
    expect(pruneReviewPackets(env.db, packet.expiresAt + 1)).toBe(1)
    expect(getReviewPacket(env.db, packet.id, packet.expiresAt + 1)).toBeNull()
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM review_findings').get()?.n,
    ).toBe(0)
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM review_conclusions').get()?.n,
    ).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('the finding limit is explicit rather than silently dropping findings', () => {
  const env = packetEnv()
  try {
    const packet = packetFor(env)
    const limit = 200
    for (let index = 0; index < limit; index++) {
      addReviewFinding(env.db, {
        packetId: packet.id,
        authorKind: 'operator',
        path: `src/${index}.ts`,
        severity: 'info',
        note: `finding ${index}`,
        snapshotId: packet.snapshotId,
      })
    }
    expect(() =>
      addReviewFinding(env.db, {
        packetId: packet.id,
        authorKind: 'operator',
        path: 'src/overflow.ts',
        severity: 'info',
        note: 'one too many',
        snapshotId: packet.snapshotId,
      }),
    ).toThrow(ReviewPacketError)
    expect(listReviewFindings(env.db, packet.id)).toHaveLength(limit)
  } finally {
    env.cleanup()
  }
})
