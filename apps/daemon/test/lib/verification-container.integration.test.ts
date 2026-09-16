import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  createVerificationRequest,
  getVerificationRequest,
  type VerificationRequestRecord,
} from '../../src/core/repos/verification-requests.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { createProtectedCheckExecutor } from '../../src/lib/verification/executor.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 gap: container execution was implemented but never *observed*. Its refusal was tested; the
// real container was not. This is the observation, against a real Docker daemon, and it is what makes
// the receipt's `network_disabled` / `read_only_memory` restrictions statements about behavior rather
// than about intent.
//
// Gated on `BAZILION_TEST_DOCKER=1` like the other real-Docker suites. Skipped by default, because a
// missing Docker must not turn into a passing test that proves nothing.

const dockerEnabled = process.env.BAZILION_TEST_DOCKER === '1'
const image = process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'debian:bookworm-slim'

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

interface ContainerEnv extends TestEnv {
  requestId: string
}

/**
 * A dirty Team repository, a captured snapshot, a docker-posture request and a held workspace lease —
 * exactly what a dispatch has when it runs checks, minus the specialist.
 */
async function containerEnv(command: string): Promise<ContainerEnv> {
  const env = makeTestEnv()
  seed(env.db, env.teamId)
  const teamPath = env.paths.teamDir(env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(teamPath, 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  // The shared memory directory the coding path over-mounts read-only. It must exist to be mounted, so
  // its absence would silently weaken the posture instead of failing.
  mkdirSync(join(teamPath, 'memory'), { recursive: true })
  writeFileSync(join(teamPath, 'memory', 'notes.md'), 'team memory\n')
  // A dirty change, so the check runs against a captured proposed revision rather than a clean tree.
  writeFileSync(join(teamPath, 'app.txt'), 'one\ntwo\nthree\n')

  const snapshot = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  const request = createVerificationRequest(env.db, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: snapshot.reference.id,
    snapshotComplete: true,
    head: snapshot.snapshot.head,
    baseOid: snapshot.snapshot.base.resolvedOid,
    environment: { image, sandbox: 'docker', cwd: '.' },
    checks: [{ command, cwd: '.', purpose: 'suite', timeoutMs: 60_000 }],
  })

  return { ...env, requestId: request.id }
}

interface ExecuteResult {
  state: string
  exitCode: number | null
  output: string
  commandId: string | null
  /** Container registrations read while the lease is still held; release clears them. */
  resources: Array<{ kind: string; creation_acknowledged: number; cleanup_confirmed: number }>
}

async function execute(
  env: ContainerEnv,
  requestId: string,
  command: string,
): Promise<ExecuteResult> {
  const request = getVerificationRequest(env.db, env.teamId, requestId)
  if (!request) throw new Error('request was not stored')
  const lease = await workspaceLifecycle(env.db).claim(
    env.teamId,
    env.paths.teamDir(env.teamId),
    'agent',
  )
  try {
    const result = await createProtectedCheckExecutor({
      db: env.db,
      paths: env.paths,
      request,
      attemptId: 'attempt-1',
      teamPath: env.paths.teamDir(env.teamId),
      secrets: () => [],
      env: {
        BAZILION_BASH_SANDBOX: 'docker',
        BAZILION_BASH_SANDBOX_IMAGE: image,
      },
      containerLifecycle: workspaceLifecycle(env.db).containers(lease),
    }).run({ command, cwd: '.', timeoutMs: 60_000, purpose: 'verification', writablePaths: [] })
    const resources = env.db.raw
      .query<{ kind: string; creation_acknowledged: number; cleanup_confirmed: number }, []>(
        'SELECT kind, creation_acknowledged, cleanup_confirmed FROM workspace_resources',
      )
      .all()
    return { ...result, resources }
  } finally {
    await workspaceLifecycle(env.db).release(lease)
  }
}

describe.skipIf(!dockerEnabled)('verification container posture', () => {
  test('a captured check observes the container, not the host', async () => {
    const command = [
      'printf "pwd=%s" "$PWD"',
      'test -f /etc/debian_version && printf " debian=yes"',
      'test -f /workspace/app.txt && printf " workspace=yes"',
    ].join('; ')
    const env = await containerEnv(command)
    try {
      const result = await execute(env, env.requestId, command)
      expect(result.state).toBe('succeeded')
      expect(result.output).toContain('pwd=/workspace')
      expect(result.output).toContain('debian=yes')
      expect(result.output).toContain('workspace=yes')
      const receipt = env.db.raw
        .query<{ receipt_json: string; state: string }, [string]>(
          'SELECT receipt_json, state FROM coding_commands WHERE id = ?',
        )
        .get(result.commandId ?? '')
      expect(receipt?.state).toBe('succeeded')
      const environment = (
        JSON.parse(receipt?.receipt_json ?? '{}') as {
          environment: { imageId: string | null; restrictions: string[] }
        }
      ).environment as {
        imageId: string | null
        restrictions: string[]
      }
      expect(environment.imageId).toBe(image)
      expect(environment.restrictions).toContain('network_disabled')
      expect(environment.restrictions).toContain('read_only_memory')
    } finally {
      env.cleanup()
    }
  }, 120_000)

  test('a captured check cannot write the Team shared memory', async () => {
    const command = 'echo probe > /workspace/memory/probe.txt'
    const env = await containerEnv(command)
    try {
      const result = await execute(env, env.requestId, command)
      // Read-only filesystem: the write is refused by the kernel, so the outcome is a real failure.
      expect(result.state).toBe('failed')
      expect(result.exitCode).not.toBe(0)
      expect(existsSync(join(env.paths.teamDir(env.teamId), 'memory', 'probe.txt'))).toBe(false)
    } finally {
      env.cleanup()
    }
  }, 120_000)

  test('a captured check has no network', async () => {
    const command = '(exec 3<>/dev/tcp/1.1.1.1/80) 2>/dev/null && echo reachable || echo blocked'
    const env = await containerEnv(command)
    try {
      const result = await execute(env, env.requestId, command)
      expect(result.output).toContain('blocked')
    } finally {
      env.cleanup()
    }
  }, 120_000)

  test('the container a check created is registered against the workspace lease', async () => {
    const command = 'printf done'
    const env = await containerEnv(command)
    try {
      const { resources } = await execute(env, env.requestId, command)
      // Registered before create and confirmed removed after: an interrupted check is recoverable
      // rather than an orphaned container nobody knows about.
      expect(resources.length).toBeGreaterThan(0)
      expect(resources.every((row) => row.creation_acknowledged === 1)).toBe(true)
      expect(resources.every((row) => row.cleanup_confirmed === 1)).toBe(true)
    } finally {
      env.cleanup()
    }
  }, 120_000)
})

describe.skipIf(dockerEnabled)('verification container posture (skipped)', () => {
  test('real-Docker observation requires BAZILION_TEST_DOCKER=1', () => {
    expect(process.env.BAZILION_TEST_DOCKER).not.toBe('1')
  })
})
