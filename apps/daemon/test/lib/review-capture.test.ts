import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  addReviewFinding,
  getReviewPacket,
  listReviewFindings,
  setReviewPacketState,
} from '../../src/core/repos/review-packets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { releaseReviewGrant, validateReviewGrant } from '../../src/lib/review/approval.ts'
import { captureReviewPacket, readReviewPacketReport } from '../../src/lib/review/capture.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slice 2: capture validates the real inputs, and a refusal writes nothing.
//
// The property being protected is that a review describes *one captured revision*. Anything that cannot
// be established — a snapshot outside its window, a reviewer who is not a live Team member, a requester
// reviewing itself — is refused with a reason rather than captured as a packet that fails later.

function seed(db: BazilionDb, teamId: string, status = 'idle'): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'reviewer', 'archived']) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, ?, ?, ?, 1)`,
      [id, id, id === 'archived' ? 'archived' : status, `/tmp/${id}`, teamId],
    )
  }
  // A real member of a *different* Team, and an id nothing knows about: both must be refused, for the
  // same reason, because membership is re-read rather than trusted from the caller.
  db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('other-team', 'Other', 1)")
  db.raw.run(
    `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
     VALUES ('outsider', 'profile', 'outsider', 'idle', '/tmp/outsider', 'other-team', 1)`,
  )
}

function git(env: TestEnv, ...args: string[]): string {
  return execFileSync('git', ['-C', env.paths.teamDir(env.teamId), ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: env.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

/** A Team with a repository and one captured revision of a dirty change. */
async function repoEnv(): Promise<{ env: TestEnv; snapshotId: string }> {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  return { env, snapshotId: captured.reference.id }
}

function count(db: BazilionDb, table: string): number {
  return db.raw.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0
}

test('a captured packet describes the revision it was made from', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    const result = captureReviewPacket(env.db, env.paths, {
      teamId: env.teamId,
      snapshotId,
      reviewerAgentId: 'reviewer',
      summary: 'fix the crash',
      requesterKind: 'agent',
      requesterAgentId: 'coder',
    })
    if (result.kind !== 'captured') throw new Error(`capture blocked: ${result.blocker.reason}`)
    expect(result.packet).toMatchObject({
      snapshotId,
      snapshotComplete: true,
      requesterKind: 'agent',
      requesterAgentId: 'coder',
      reviewerAgentId: 'reviewer',
      state: 'open',
      summary: 'fix the crash',
    })
    // The base and head come from the captured manifest, not from the caller.
    expect(result.packet.baseOid).toMatch(/^[0-9a-f]{40}$/)
    expect(result.packet.head).toBe(result.packet.head)

    const report = await readReviewPacketReport(env.db, env.paths, env.teamId, result.packet.id)
    expect(report?.applicability).toEqual({ comparison: 'identical', stale: false })
    // Completion facts start honest: a prepared change is not a review, a commit or an acceptance.
    expect(report?.facts).toMatchObject({
      changePrepared: true,
      checksCurrent: false,
      reviewed: false,
      reported: { committed: null, merged: null, productionAccepted: null },
    })
  } finally {
    env.cleanup()
  }
})

test('every unestablishable input is refused, and a refusal writes nothing', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    const cases: Array<[Parameters<typeof captureReviewPacket>[2], RegExp]> = [
      [
        {
          teamId: 'no-such-team',
          snapshotId,
          requesterKind: 'operator',
        },
        /known Team/,
      ],
      [
        { teamId: env.teamId, snapshotId: 'never-captured', requesterKind: 'operator' },
        /not captured in this Team/,
      ],
      [
        {
          teamId: env.teamId,
          snapshotId,
          reviewerAgentId: 'outsider',
          requesterKind: 'operator',
        },
        /not a live member/,
      ],
      [
        {
          teamId: env.teamId,
          snapshotId,
          reviewerAgentId: 'archived',
          requesterKind: 'operator',
        },
        /not a live member/,
      ],
      [
        {
          teamId: env.teamId,
          snapshotId,
          reviewerAgentId: 'reviewer',
          requesterKind: 'agent',
          requesterAgentId: 'reviewer',
        },
        /same Agent/,
      ],
      [
        {
          teamId: env.teamId,
          snapshotId,
          requesterKind: 'agent',
          requesterAgentId: 'outsider',
        },
        /not a live member/,
      ],
    ]
    for (const [intent, expected] of cases) {
      const result = captureReviewPacket(env.db, env.paths, intent)
      expect(result.kind).toBe('blocked')
      if (result.kind === 'blocked') expect(result.blocker.detail).toMatch(expected)
    }
    // Zero rows: nothing was captured, so nothing can look like a review later.
    expect(count(env.db, 'review_packets')).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('a packet of an older revision survives later edits and reads stale', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    const result = captureReviewPacket(env.db, env.paths, {
      teamId: env.teamId,
      snapshotId,
      reviewerAgentId: 'reviewer',
      requesterKind: 'operator',
    })
    if (result.kind !== 'captured') throw new Error('capture blocked')

    // A finding made against the captured revision, with line context only.
    addReviewFinding(env.db, {
      packetId: result.packet.id,
      authorKind: 'operator',
      path: 'app.txt',
      severity: 'major',
      note: 'the new branch has no test',
      lineStart: 3,
      lineEnd: 3,
      snapshotId,
    })

    // The repository moves on. The packet is not rewritten — it becomes stale for the current code.
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const report = await readReviewPacketReport(env.db, env.paths, env.teamId, result.packet.id)
    expect(report?.applicability).toEqual({ comparison: 'changed', stale: true })
    // The captured revision and the finding are unchanged, and the finding is still open: a moved tree
    // is not evidence that anything was fixed.
    expect(report?.packet.snapshot.id).toBe(snapshotId)
    expect(report?.findings[0]).toMatchObject({
      snapshotId,
      state: 'open',
      applicability: 'changed',
      resolution: null,
    })
    expect(getReviewPacket(env.db, result.packet.id)?.snapshotId).toBe(snapshotId)
    expect(listReviewFindings(env.db, result.packet.id)).toHaveLength(1)
  } finally {
    env.cleanup()
  }
})

test('an incomplete capture cannot be reviewed, because a partial revision is not the revision', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    // Mark the stored manifest incomplete, which is what a withheld or unstable file produces.
    const stored = env.db.raw
      .query<{ manifest_json: string }, [string]>(
        'SELECT manifest_json FROM source_snapshots WHERE snapshot_id = ?',
      )
      .get(snapshotId)
    const manifest = JSON.parse(stored?.manifest_json ?? '{}') as Record<string, unknown>
    manifest.complete = false
    env.db.raw.run('UPDATE source_snapshots SET manifest_json = ? WHERE snapshot_id = ?', [
      JSON.stringify(manifest),
      snapshotId,
    ])

    const result = captureReviewPacket(env.db, env.paths, {
      teamId: env.teamId,
      snapshotId,
      reviewerAgentId: 'reviewer',
      requesterKind: 'operator',
    })
    expect(result.kind).toBe('blocked')
    if (result.kind === 'blocked') expect(result.blocker.reason).toBe('snapshot_incomplete')
    expect(count(env.db, 'review_packets')).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('a held review is released only after revalidation, and a losing race is not released', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    const captured = captureReviewPacket(env.db, env.paths, {
      teamId: env.teamId,
      snapshotId,
      reviewerAgentId: 'reviewer',
      requesterKind: 'operator',
    })
    if (captured.kind !== 'captured') throw new Error('capture blocked')
    const packetId = captured.packet.id

    // Nothing is released unless it is actually waiting: a packet that is `open` has no hold to lift.
    expect(validateReviewGrant(env.db, env.paths, packetId)).toMatch(/not awaiting approval/)
    setReviewPacketState(env.db, packetId, 'awaiting_approval')
    expect(validateReviewGrant(env.db, env.paths, packetId)).toBeNull()

    // The reviewer leaving the Team is exactly the change a release must catch.
    env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = 'reviewer'")
    expect(validateReviewGrant(env.db, env.paths, packetId)).toMatch(/missing or archived/)
    env.db.raw.run("UPDATE agents SET status = 'idle' WHERE id = 'reviewer'")
    expect(validateReviewGrant(env.db, env.paths, packetId)).toBeNull()

    // The evidence window closing is the other one.
    const stored = getReviewPacket(env.db, packetId)
    env.db.raw.run('DELETE FROM source_snapshots WHERE snapshot_id = ?', [stored?.snapshotId])
    expect(validateReviewGrant(env.db, env.paths, packetId)).toMatch(
      /no longer inside its retention/,
    )
  } finally {
    env.cleanup()
  }
})

test('releasing a held review returns it to open, and a cancellation that raced wins', async () => {
  const { env, snapshotId } = await repoEnv()
  try {
    const captured = captureReviewPacket(env.db, env.paths, {
      teamId: env.teamId,
      snapshotId,
      reviewerAgentId: 'reviewer',
      requesterKind: 'operator',
    })
    if (captured.kind !== 'captured') throw new Error('capture blocked')
    const packetId = captured.packet.id

    setReviewPacketState(env.db, packetId, 'awaiting_approval')
    releaseReviewGrant(env.db, packetId)
    expect(getReviewPacket(env.db, packetId)?.state).toBe('open')

    // A packet cancelled while the operator was deciding is not resurrected by a late approval.
    setReviewPacketState(env.db, packetId, 'cancelled')
    releaseReviewGrant(env.db, packetId)
    expect(getReviewPacket(env.db, packetId)?.state).toBe('cancelled')
  } finally {
    env.cleanup()
  }
})
