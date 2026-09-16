import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { listVerificationRequests } from '../../src/core/repos/verification-requests.ts'
import { createVerificationRequestHost } from '../../src/lib/verification/request-capability.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044: the requester's half of the loop.
//
// The story's task experience is "have our tester verify this fix" — the coder captures the current
// change and the commands it wants run, sends one request, and yields. Without a requester-side
// capability the only requester could be the operator, which is exactly what made the result delivery
// unreachable in production even though it existed and was tested.

function seed(db: BazilionDb, teamId: string): void {
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

/** A Team with a repository: a committed base and one dirty change for the coder to hand over. */
function repoEnv(): TestEnv {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  return env
}

function hostFor(env: TestEnv, assertActive: () => void = () => {}) {
  return createVerificationRequestHost({
    db: env.db,
    paths: env.paths,
    agentId: 'coder',
    teamId: env.teamId,
    turnId: 'turn-1',
    assertActive,
  })
}

test('a coding turn captures its change and hands one request to a Team specialist', async () => {
  const env = repoEnv()
  try {
    const receipt = await hostFor(env).capture({
      specialist: 'tester',
      checks: [
        { command: 'sh check.sh', purpose: 'the declared check' },
        { command: 'sh other.sh', purpose: 'a bounded one', cwd: '', timeoutSeconds: 30 },
      ],
      summary: 'verify the fix',
      writablePaths: ['build'],
    })

    // The requester is the turn's own Agent — the worker never names one, so it cannot impersonate.
    const [record] = listVerificationRequests(env.db, env.teamId)
    expect(record).toMatchObject({
      id: receipt.requestId,
      requesterKind: 'agent',
      requesterAgentId: 'coder',
      recipientAgentId: 'tester',
      snapshotId: receipt.snapshotId,
    })
    expect(record?.environment.writablePaths).toEqual(['build'])
    // Defaults are applied by the daemon, and the checks keep the order they were given.
    const checks = env.db.raw
      .query<{ ordinal: number; command: string; cwd: string; timeout_ms: number }, [string]>(
        'SELECT ordinal, command, cwd, timeout_ms FROM verification_checks WHERE request_id = ? ORDER BY ordinal',
      )
      .all(receipt.requestId)
    expect(checks).toEqual([
      { ordinal: 0, command: 'sh check.sh', cwd: '.', timeout_ms: 120_000 },
      { ordinal: 1, command: 'sh other.sh', cwd: '.', timeout_ms: 30_000 },
    ])
    // The snapshot exists as evidence, attributed to the asking Agent and turn.
    const snapshot = env.db.raw
      .query<{ captured_by: string; agent_id: string; turn_id: string }, [string]>(
        'SELECT captured_by, agent_id, turn_id FROM source_snapshots WHERE snapshot_id = ?',
      )
      .get(receipt.snapshotId)
    expect(snapshot).toMatchObject({ captured_by: 'agent', agent_id: 'coder', turn_id: 'turn-1' })
    // The receipt tells the model what to wait on, and never claims a result.
    expect(receipt).toMatchObject({ specialist: 'tester', state: 'pending' })
  } finally {
    env.cleanup()
  }
})

test('a refusal writes nothing and says why', async () => {
  const env = repoEnv()
  try {
    const host = hostFor(env)
    // Nobody to verify: the specialist is not a member of this Team.
    await expect(
      host.capture({ specialist: 'stranger', checks: [{ command: 'x', purpose: 'y' }] }),
    ).rejects.toThrow(/was not requested/)
    expect(listVerificationRequests(env.db, env.teamId)).toHaveLength(0)
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM verification_checks').get()?.n,
    ).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('a finished turn cannot capture anything', async () => {
  const env = repoEnv()
  try {
    const host = hostFor(env, () => {
      throw new Error('Coding turn ended')
    })
    await expect(
      host.capture({ specialist: 'tester', checks: [{ command: 'x', purpose: 'y' }] }),
    ).rejects.toThrow('Coding turn ended')
    // Re-checked before the snapshot is taken, so an ended turn cannot even create evidence.
    expect(
      env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM source_snapshots').get()?.n,
    ).toBe(0)
  } finally {
    env.cleanup()
  }
})
