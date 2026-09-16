import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  setRequestState,
} from '../../src/core/repos/verification-requests.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { admitVerificationRequest } from '../../src/lib/verification/admission.ts'
import {
  releaseVerificationGrant,
  validateVerificationGrant,
} from '../../src/lib/verification/approval.ts'
import { captureVerificationRequest } from '../../src/lib/verification/capture.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 slice 4: admission revalidates, reserves the workspace, and refuses drift.
//
// The order under test is deliberate: nothing durable is claimed for a request that can no longer
// be honoured, and a claimed attempt that ran nothing is settled honestly rather than left open.

function seedAgents(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'tester']) {
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

function repo(env: TestEnv): void {
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
}

async function capturedRequest(env: TestEnv): Promise<string> {
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  const snapshot = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  const captured = captureVerificationRequest(env.db, env.paths, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: snapshot.reference.id,
    checks: [{ command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 5_000 }],
  })
  if (captured.kind !== 'captured') throw new Error('expected a captured request')
  return captured.request.id
}

test('admission claims one slot and reserves the workspace exclusively', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const requestId = await capturedRequest(env)
    const first = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(first.kind).toBe('admitted')
    if (first.kind !== 'admitted') return
    expect(first.claim.attempt.state).toBe('claimed')
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('running')

    // A second dispatch cannot adopt the live claim, and must not deadlock behind the workspace.
    const second = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(second).toMatchObject({ kind: 'deferred', reason: 'workspace_busy' })

    // Releasing the workspace leaves the claim: another process may not replay this attempt.
    await workspaceLifecycle(env.db).release(first.workspace)
    const third = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(third).toMatchObject({ kind: 'deferred', reason: 'already_owned' })
    expect(listVerificationAttempts(env.db, requestId)).toHaveLength(1)
  } finally {
    env.cleanup()
  }
})

test('drift between capture and execution blocks the request instead of testing another tree', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const requestId = await capturedRequest(env)
    // The coder (or an external editor) moves the tree while the request waits.
    writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\nfour\n')
    const admission = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(admission).toMatchObject({
      kind: 'blocked',
      blocker: { reason: 'source_changed' },
    })
    // The claimed attempt is settled as failed with its checks blocked, never left running.
    const attempt = listVerificationAttempts(env.db, requestId)[0]
    expect(attempt?.state).toBe('failed')
    expect(attempt?.error).toContain('fresh capture')
    expect(listVerificationCheckOutcomes(env.db, attempt?.id ?? '')).toEqual([
      expect.objectContaining({ state: 'blocked', commandId: null, exitCode: null }),
    ])
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('blocked')
    // The workspace is released, so a later request is not blocked by this attempt.
    const next = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(next.kind).not.toBe('admitted')
  } finally {
    env.cleanup()
  }
})

test('an unverifiable workspace is refused rather than assumed to match', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const requestId = await capturedRequest(env)
    // The capture's evidence disappears from its window.
    env.db.raw.run('DELETE FROM source_snapshots WHERE team_id = ?', [env.teamId])
    const admission = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(admission).toMatchObject({
      kind: 'blocked',
      blocker: { reason: 'snapshot_evidence_gone' },
    })
    // Nothing durable was claimed for a request that could never run.
    expect(listVerificationAttempts(env.db, requestId)).toEqual([])
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('blocked')
  } finally {
    env.cleanup()
  }
})

test('a specialist that left the Team, or an unknown request, is refused without side effects', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const requestId = await capturedRequest(env)
    env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = 'tester'")
    const archived = await admitVerificationRequest(env.db, env.paths, requestId)
    expect(archived).toMatchObject({
      kind: 'blocked',
      blocker: { reason: 'recipient_unavailable' },
    })
    expect(listVerificationAttempts(env.db, requestId)).toEqual([])

    // An unknown id is not a failure to report: there is nothing to run.
    const unknown = await admitVerificationRequest(env.db, env.paths, 'does-not-exist')
    expect(unknown).toMatchObject({ kind: 'deferred', reason: 'unknown_or_expired' })
  } finally {
    env.cleanup()
  }
})

// Review S3: the grant revalidates before releasing, so a request whose inputs no longer hold stays
// held rather than being released into a dispatch that must fail.
test('a grant releases a held request, and refuses once its evidence is gone', async () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    repo(env)
    const requestId = await capturedRequest(env)
    setRequestState(env.db, requestId, 'awaiting_approval')

    expect(validateVerificationGrant(env.db, env.paths, requestId)).toBeNull()
    releaseVerificationGrant(env.db, requestId)
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('pending')

    // A request that is no longer held is not released again.
    releaseVerificationGrant(env.db, requestId)
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('pending')

    // With its evidence gone, the grant refuses and the request stays where it is.
    setRequestState(env.db, requestId, 'awaiting_approval')
    env.db.raw.run('DELETE FROM source_snapshots WHERE team_id = ?', [env.teamId])
    expect(validateVerificationGrant(env.db, env.paths, requestId)).toContain('retention window')
    expect(getVerificationRequest(env.db, env.teamId, requestId)?.state).toBe('awaiting_approval')

    // An unknown request is refused rather than throwing.
    expect(validateVerificationGrant(env.db, env.paths, 'nope')).toContain('unknown')
  } finally {
    env.cleanup()
  }
})
