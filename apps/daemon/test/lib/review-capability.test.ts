import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  addReviewFinding,
  listReviewConclusions,
  listReviewFindings,
} from '../../src/core/repos/review-packets.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { createReviewCapabilityHost } from '../../src/lib/review/reviewer-capability.ts'
import { reviewTools } from '../../src/runtime/tools/review.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 slice 6: the reviewer's capability, which is the only thing a reviewer Agent can reach.
//
// Two properties matter most. It is **read-only by construction** — there is no execution path in the
// capability at all, asserted here by the tool list. And it is **honest about content**: a captured
// revision's manifest survives the working tree moving, but its patch does not, so a reviewer is told
// which of the two it has instead of being shown later code as if it were the reviewed change.

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

async function reviewingEnv() {
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
    summary: 'the new branch is untested',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (result.kind !== 'captured') throw new Error('capture blocked')
  const host = createReviewCapabilityHost({
    db: env.db,
    paths: env.paths,
    packet: result.packet,
    attemptId: 'attempt-1',
    assertActive: () => {},
  })
  return { env, packet: result.packet, host }
}

test('the capability is read-only: no tool can run, write or publish anything', () => {
  // Pure shape assertion, no fixture needed: the names and their closed argument schemas are the contract.
  const tools = reviewTools({
    read: async () => {
      throw new Error('unused')
    },
    path: async () => {
      throw new Error('unused')
    },
    addFinding: async () => ({ findingId: 'x', ordinal: 1 }),
    conclude: async () => ({ conclusion: 'commented' }),
  })
  expect(tools.map((tool) => tool.def.name)).toEqual([
    'review_packet',
    'review_path',
    'review_finding',
    'review_conclusion',
  ])
  for (const tool of tools) {
    const parameters = tool.def.parameters as { additionalProperties?: boolean }
    expect(parameters.additionalProperties).toBe(false)
  }
  // No verb for execution, editing, browsing or publication exists to be widened.
  const names = tools.map((tool) => tool.def.name).join(' ')
  for (const forbidden of ['bash', 'shell', 'command', 'edit', 'write', 'publish', 'deliver']) {
    expect(names).not.toContain(forbidden)
  }
})

test('a reviewer sees the captured revision’s change list and its content while it is reproducible', async () => {
  const { env, host, packet } = await reviewingEnv()
  try {
    const brief = await host.read()
    expect(brief).toMatchObject({
      packetId: packet.id,
      summary: 'the new branch is untested',
      contentAvailable: true,
      contentUnavailableReason: null,
      conclusion: null,
    })
    expect(brief.changes).toEqual([{ path: 'app.txt', status: 'modified', previousPath: null }])
    const content = await host.path('app.txt')
    expect(content.reason).toBeNull()
    expect(content.patch).toContain('three')
  } finally {
    env.cleanup()
  }
})

test('once the tree moves, the reviewer is told content is gone instead of shown later code', async () => {
  const { env, host } = await reviewingEnv()
  try {
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const brief = await host.read()
    // The change list is from the capture and survives. The content does not, and says so.
    expect(brief.changes).toEqual([{ path: 'app.txt', status: 'modified', previousPath: null }])
    expect(brief.contentAvailable).toBe(false)
    expect(brief.contentUnavailableReason).toMatch(/no longer reproducible/)
    const content = await host.path('app.txt')
    expect(content.patch).toBeNull()
    expect(content.reason).toMatch(/no longer reproducible/)
    expect(JSON.stringify(content)).not.toContain('four')
  } finally {
    env.cleanup()
  }
})

test('a finding must name a path in the reviewed revision, and an unread revision makes it unverified', async () => {
  const { env, host, packet } = await reviewingEnv()
  try {
    const created = await host.addFinding({
      path: 'app.txt',
      severity: 'major',
      note: 'the new branch has no test',
      lineStart: 3,
      lineEnd: 3,
    })
    const stored = listReviewFindings(env.db, packet.id)[0]
    expect(stored).toMatchObject({
      id: created.findingId,
      path: 'app.txt',
      severity: 'major',
      state: 'open',
      authorKind: 'agent',
      authorAgentId: 'reviewer',
      // The revision the finding was made against, never "whatever is on disk".
      snapshotId: packet.snapshotId,
    })
    // A path outside the revision cannot be correlated to it, so it is refused rather than stored.
    await expect(
      host.addFinding({ path: 'src/other.ts', severity: 'info', note: 'x' }),
    ).rejects.toThrow(/not part of the reviewed revision.*app\.txt/s)

    // With the tree moved, a finding is recorded as unverified: the reviewer could see the shape of the
    // revision but not its content, and that is the honest state.
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const unverified = await host.addFinding({
      path: 'app.txt',
      severity: 'info',
      note: 'could not read the content of this revision',
    })
    expect(
      listReviewFindings(env.db, packet.id).find((f) => f.id === unverified.findingId)?.state,
    ).toBe('unverified')
  } finally {
    env.cleanup()
  }
})

test('a reviewer concludes once, and the conclusion names the revision it is about', async () => {
  const { env, host, packet } = await reviewingEnv()
  try {
    expect(await host.conclude({ conclusion: 'changes_requested', note: 'one blocker' })).toEqual({
      conclusion: 'changes_requested',
    })
    const conclusions = listReviewConclusions(env.db, packet.id)
    expect(conclusions).toHaveLength(1)
    expect(conclusions[0]).toMatchObject({
      conclusion: 'changes_requested',
      reviewerKind: 'agent',
      reviewerAgentId: 'reviewer',
      snapshotId: packet.snapshotId,
    })
    // A second conclusion replaces the reviewer's own rather than accumulating.
    await host.conclude({ conclusion: 'recommended' })
    expect(listReviewConclusions(env.db, packet.id)).toHaveLength(1)
    expect(listReviewConclusions(env.db, packet.id)[0]?.conclusion).toBe('recommended')
  } finally {
    env.cleanup()
  }
})

test('a finished turn cannot read or write through the capability', async () => {
  const { env, packet } = await reviewingEnv()
  try {
    let active = true
    const bound = createReviewCapabilityHost({
      db: env.db,
      paths: env.paths,
      packet,
      attemptId: 'attempt-1',
      assertActive: () => {
        if (!active) throw new Error('Review turn ended')
      },
    })
    active = false
    await expect(bound.read()).rejects.toThrow('Review turn ended')
    await expect(
      bound.addFinding({ path: 'app.txt', severity: 'info', note: 'x' }),
    ).rejects.toThrow('Review turn ended')
    // Nothing was written by the refused calls.
    expect(listReviewFindings(env.db, packet.id)).toHaveLength(0)
    // A finding recorded by someone else before the turn ended is still readable by the operator later.
    addReviewFinding(env.db, {
      packetId: packet.id,
      authorKind: 'operator',
      path: 'app.txt',
      severity: 'info',
      note: 'operator note',
      snapshotId: packet.snapshotId,
    })
    expect(listReviewFindings(env.db, packet.id)).toHaveLength(1)
  } finally {
    env.cleanup()
  }
})
