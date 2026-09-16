import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVIEW_LIMITS } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import {
  captureVerificationRequest,
  readVerificationReport,
  type VerificationCaptureResult,
} from '../../src/lib/verification/capture.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 slice 2: capture validates the actual inputs and reports blockers instead of substituting.

function seedAgents(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  db.raw.run("INSERT INTO teams (id, name, created_at) VALUES ('other-team', 'Other', 1)")
  for (const [id, team] of [
    ['coder', teamId],
    ['tester', teamId],
    ['outsider', 'other-team'],
  ]) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, team],
    )
  }
}

function teamDir(env: TestEnv): string {
  return env.paths.teamDir(env.teamId)
}

function git(env: TestEnv, ...args: string[]): string {
  return execFileSync('git', ['-C', teamDir(env), ...args], {
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

function repo(env: TestEnv): void {
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(teamDir(env), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
}

async function snapshot(env: TestEnv, path = 'app.txt', contents = 'one\ntwo\nthree\n') {
  writeFileSync(join(teamDir(env), path), contents)
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  return captured.reference.id
}

const checks = [{ command: 'pnpm test', cwd: '.', purpose: 'unit suite', timeoutMs: 120_000 }]

function intent(env: TestEnv, snapshotId: string, overrides: Record<string, unknown> = {}) {
  return {
    teamId: env.teamId,
    requesterKind: 'agent' as const,
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId,
    checks,
    summary: 'verify the fix',
    ...overrides,
  }
}

test('a complete capture against a live same-Team specialist freezes the admitted environment', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const snapshotId = await snapshot(env)
    const result = captureVerificationRequest(env.db, env.paths, intent(env, snapshotId))
    expect(result.kind).toBe('captured')
    if (result.kind !== 'captured') return
    expect(result.request).toMatchObject({
      teamId: env.teamId,
      requesterKind: 'agent',
      requesterAgentId: 'coder',
      recipientAgentId: 'tester',
      snapshotId,
      snapshotComplete: true,
      state: 'pending',
      summary: 'verify the fix',
    })
    // Environment facts come from the admitted environment, not from the caller.
    expect(result.request.environment.image).toBeTruthy()
    expect(['off', 'docker']).toContain(result.request.environment.sandbox)
  } finally {
    env.cleanup()
  }
})

test('capture refuses unavailable or unsound inputs with a specific blocker', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const snapshotId = await snapshot(env)
    env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = 'archived-tester'")
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES ('archived-tester', 'profile', 'Archived', 'archived', '/tmp/a', ?, 1)`,
      [env.teamId],
    )
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ snapshotId: 'never-captured' }, 'snapshot_unavailable'],
      [{ snapshotId: '' }, 'snapshot_unavailable'],
      [{ recipientAgentId: 'missing' }, 'recipient_unavailable'],
      [{ recipientAgentId: 'archived-tester' }, 'recipient_unavailable'],
      [{ recipientAgentId: 'outsider' }, 'recipient_not_same_team'],
      [{ requesterAgentId: 'missing' }, 'requester_unavailable'],
      [{ requesterAgentId: 'outsider' }, 'requester_unavailable'],
      [{ requesterAgentId: 'tester' }, 'unsupported'],
      [{ checks: [] }, 'unsupported'],
      [{ writablePaths: Array.from({ length: 17 }, (_, i) => `dist/${i}`) }, 'unsupported'],
    ]
    for (const [override, reason] of cases) {
      const result: VerificationCaptureResult = captureVerificationRequest(
        env.db,
        env.paths,
        intent(env, snapshotId, override),
      )
      expect(result.kind, JSON.stringify(override)).toBe('blocked')
      if (result.kind !== 'blocked') continue
      expect(result.blocker.reason, JSON.stringify(override)).toBe(reason)
      expect(result.blocker.detail.length).toBeGreaterThan(0)
    }
    // A blocked capture writes nothing at all.
    const stored = env.db.raw
      .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_requests')
      .get()
    expect(stored?.count).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('an incomplete capture never authorizes execution', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const snapshotId = await snapshot(env)
    // Coverage below the limit: the capture is honest about being incomplete, and says which
    // entry it could not read.
    writeFileSync(join(teamDir(env), 'big.txt'), 'x'.repeat(4_000))
    const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
      capturedBy: 'operator',
      base: 'HEAD',
      includeUntracked: ['big.txt'],
      limits: { ...REVIEW_LIMITS, fileBytes: 16 },
    })
    expect(captured.snapshot.complete).toBe(false)
    expect(captured.snapshot.entries).toContainEqual(
      expect.objectContaining({ path: 'big.txt', kind: 'too_large' }),
    )
    const result = captureVerificationRequest(env.db, env.paths, intent(env, captured.reference.id))
    expect(result).toMatchObject({ kind: 'blocked', blocker: { reason: 'snapshot_incomplete' } })
    // The complete one still works, so the refusal is about coverage and nothing else.
    expect(captureVerificationRequest(env.db, env.paths, intent(env, snapshotId)).kind).toBe(
      'captured',
    )
  } finally {
    env.cleanup()
  }
})

test('the report composes the contract, its attempts, and current applicability', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const snapshotId = await snapshot(env)
    const result = captureVerificationRequest(env.db, env.paths, intent(env, snapshotId))
    if (result.kind !== 'captured') throw new Error('expected a captured request')
    const report = await readVerificationReport(env.db, env.paths, env.teamId, result.request.id)
    expect(report?.request.id).toBe(result.request.id)
    expect(report?.checks).toEqual([
      { ordinal: 0, command: 'pnpm test', cwd: '.', purpose: 'unit suite', timeoutMs: 120_000 },
    ])
    // Nothing has run yet: no attempts, and no invented outcomes.
    expect(report?.attempts).toEqual([])
    expect(report?.applicability).toEqual({ comparison: 'identical', testedSnapshotId: snapshotId })

    // Editing the source makes the result show as changed, never as a pass.
    writeFileSync(join(teamDir(env), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const after = await readVerificationReport(env.db, env.paths, env.teamId, result.request.id)
    expect(after?.applicability).toEqual({ comparison: 'changed', testedSnapshotId: snapshotId })
    // Another Team cannot read it, and an expired request reads as absent.
    expect(
      await readVerificationReport(env.db, env.paths, 'other-team', result.request.id),
    ).toBeNull()
    expect(await readVerificationReport(env.db, env.paths, env.teamId, 'missing')).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('capture refuses a Team that is not a repository without inventing one', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    // No git repository in the Team directory, so no snapshot can exist to bind.
    const result = captureVerificationRequest(env.db, env.paths, intent(env, 'anything'))
    expect(result).toMatchObject({ kind: 'blocked', blocker: { reason: 'snapshot_unavailable' } })
  } finally {
    env.cleanup()
  }
})

test('a captured request is not a peer message, so an inbox wake has nothing to consume', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const snapshotId = await snapshot(env)
    const result = captureVerificationRequest(env.db, env.paths, intent(env, snapshotId))
    expect(result.kind).toBe('captured')
    // The typed request is dispatched by its own state machine, never by the ordinary inbox path.
    // If a request were also a peer message, an inbox wake could consume it as an unrestricted
    // coding turn — so the absence of a message row is the invariant, asserted rather than assumed.
    const messages = env.db.raw
      .query<{ count: number }, []>('SELECT count(*) AS count FROM messages')
      .get()
    expect(messages?.count).toBe(0)
    // A request that carries a peer message id only *references* one; it still creates none itself.
    const blocked = captureVerificationRequest(env.db, env.paths, intent(env, 'missing-snapshot'))
    expect(blocked.kind).toBe('blocked')
    expect(
      env.db.raw.query<{ count: number }, []>('SELECT count(*) AS count FROM messages').get()
        ?.count,
    ).toBe(0)
  } finally {
    env.cleanup()
  }
})
