import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  addReviewFinding,
  getReviewPacket,
  recordReviewConclusion,
} from '../../src/core/repos/review-packets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { buildReviewExport } from '../../src/lib/review/export.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slice 5: the handoff.
//
// A handoff is where overclaiming does the most damage, so these tests are mostly about what the export
// refuses to say: no patch for code it cannot vouch for, no unstated open findings, and no implication
// that a conclusion is acceptance.

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

async function packetEnv() {
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
  const result = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    summary: 'the new branch should be covered by a test',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (result.kind !== 'captured') throw new Error('capture blocked')
  return { env, packetId: result.packet.id, snapshotId: captured.reference.id }
}

test('a handoff describes one revision, names open findings, and never claims acceptance', async () => {
  const { env, packetId, snapshotId } = await packetEnv()
  try {
    addReviewFinding(env.db, {
      packetId,
      authorKind: 'agent',
      authorAgentId: 'reviewer',
      path: 'app.txt',
      severity: 'major',
      note: 'the new branch has no test',
      lineStart: 3,
      snapshotId,
    })
    recordReviewConclusion(env.db, {
      packetId,
      reviewerKind: 'agent',
      reviewerAgentId: 'reviewer',
      conclusion: 'changes_requested',
      note: 'one finding',
      snapshotId,
    })

    const result = await buildReviewExport(env.db, env.paths, env.teamId, packetId)
    if (result.kind !== 'exported') throw new Error('export refused')
    const { export: handoff } = result
    expect(handoff.revision).toBe(snapshotId)
    expect(handoff.patch).toContain('app.txt')
    // The open finding is visible in the export itself, not only in the packet.
    expect(handoff.unresolved).toEqual([
      {
        path: 'app.txt',
        severity: 'major',
        note: 'the new branch has no test',
        applicability: 'identical',
      },
    ])
    expect(handoff.handoff).toContain('## Unresolved findings')
    expect(handoff.handoff).toContain('the new branch has no test')
    expect(handoff.handoff).toContain('changes_requested (reviewer)')
    // The two things a handoff must not imply.
    expect(handoff.limitations.join(' ')).toMatch(/not operator acceptance/)
    expect(handoff.limitations.join(' ')).toMatch(/remain unresolved/)
    expect(handoff.patchTruncated).toBe(false)
    // Recording the export names the revision it was made from.
    expect(getReviewPacket(env.db, packetId)?.exportRevision).toBe(snapshotId)
    expect(getReviewPacket(env.db, packetId)?.exportedAt).toBeGreaterThan(0)
  } finally {
    env.cleanup()
  }
})

test('a moved tree yields no patch, and says why instead of showing different code', async () => {
  const { env, packetId } = await packetEnv()
  try {
    // The tree moves after the review. The reviewed revision is unchanged; the *current* code is not it.
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const result = await buildReviewExport(env.db, env.paths, env.teamId, packetId)
    if (result.kind !== 'exported') throw new Error('export refused')
    expect(result.export.patch).toBe('')
    expect(result.export.limitations.join(' ')).toMatch(/no patch is offered/)
    // The revision identity still travels, so a consumer can tell what this handoff is about.
    expect(result.export.revision).toBe(result.export.snapshotId)
  } finally {
    env.cleanup()
  }
})

test('an unverified finding is reported as unverified, not as an open issue at a line', async () => {
  const { env, packetId, snapshotId } = await packetEnv()
  try {
    addReviewFinding(env.db, {
      packetId,
      authorKind: 'agent',
      authorAgentId: 'reviewer',
      path: 'deleted-later.txt',
      severity: 'minor',
      note: 'could not be correlated to this revision',
      snapshotId,
      state: 'unverified',
    })
    const result = await buildReviewExport(env.db, env.paths, env.teamId, packetId)
    if (result.kind !== 'exported') throw new Error('export refused')
    expect(result.export.limitations.join(' ')).toMatch(/unverified/)
    // It is still listed as unresolved: an uncorrelated finding is not a resolved one.
    expect(result.export.unresolved.map((finding) => finding.path)).toEqual(['deleted-later.txt'])
  } finally {
    env.cleanup()
  }
})

test('a missing packet is refused rather than exported empty', async () => {
  const { env } = await packetEnv()
  try {
    const result = await buildReviewExport(env.db, env.paths, env.teamId, 'no-such-packet')
    expect(result).toMatchObject({ kind: 'refused' })
    if (result.kind === 'refused') expect(result.refusal.reason).toBe('packet_unavailable')
  } finally {
    env.cleanup()
  }
})

test('a packet whose evidence window has passed is not reachable at all', async () => {
  const { env, packetId } = await packetEnv()
  try {
    const packet = getReviewPacket(env.db, packetId)
    if (!packet) throw new Error('missing packet')
    // Retention is part of the contract: past its window the packet is gone, so a handoff cannot be
    // produced from a record nobody can verify.
    const { pruneReviewPackets } = await import('../../src/core/repos/review-packets.ts')
    pruneReviewPackets(env.db, packet.expiresAt + 1)
    const result = await buildReviewExport(env.db, env.paths, env.teamId, packetId)
    expect(result).toMatchObject({ kind: 'refused' })
  } finally {
    env.cleanup()
  }
})
