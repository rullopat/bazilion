import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERIFICATION_OUTCOME_LIMITS } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import { getCodingCommand } from '../../src/core/repos/coding-commands.ts'
import {
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
} from '../../src/core/repos/verification-requests.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureVerificationRequest } from '../../src/lib/verification/capture.ts'
import { dispatchVerificationRequest } from '../../src/lib/verification/dispatch.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 acceptance criterion 1, observed end to end without a model: capture a request against a
// real dirty change, dispatch it, and read back the receipts the executor produced. The fixture worker
// performs only what the capability allows — read the request, run each declared check — so this
// exercises the real claim → IPC → executor → receipt → settle path.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
// The model runtime is stubbed: the fixture worker never opens a session, so this test observes the
// dispatch → capability → executor → receipt → settle path with no provider and no model in the loop.
vi.mock('../../src/lib/protected-provider.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/protected-provider.ts')>()),
  resolveProtectedProviderRuntime: async () => ({
    // The full admitted runtime shape the spawner validates. It is inert here: the fixture worker
    // never opens a session, so no provider is contacted.
    // Only the required keys: the optional endpoint/credential fields must be absent or valid.
    runtime: {
      providerName: 'lmstudio',
      modelId: 'model',
      reasoningLevel: 'medium',
      apiKey: 'fixture-token',
    },
    refreshApiKey: async () => 'fixture-token',
  }),
}))

beforeEach(() => {
  env = makeTestEnv()
})
afterEach(() => {
  env.cleanup()
})

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

test('a captured dirty change is verified end to end and the receipts identify it', async () => {
  seed(env.db, env.teamId)
  // A real repository with a real dirty change: the working tree differs from HEAD.
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  // The check writes into the declared output directory *and* somewhere it never declared, so the
  // observation has both sides to report.
  writeFileSync(
    join(env.paths.teamDir(env.teamId), 'check.sh'),
    '#!/bin/sh\nmkdir -p build && echo out > build/out.txt && echo stray > stray.txt\nexit 0\n',
  )

  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-before',
    toolCallId: 'call-before',
    base: 'HEAD',
  })
  expect(captured.snapshot.complete).toBe(true)

  const request = captureVerificationRequest(env.db, env.paths, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: captured.reference.id,
    checks: [{ command: 'sh check.sh', cwd: '.', purpose: 'sanity check', timeoutMs: 30_000 }],
    writablePaths: ['build'],
    summary: 'verify the fix',
  })
  if (request.kind !== 'captured') throw new Error(`capture blocked: ${request.blocker.reason}`)

  const result = await dispatchVerificationRequest(request.request.id, {
    workerEntryPath: fileURLToPath(
      new URL('../fixtures/verification-worker-entry.ts', import.meta.url),
    ),
  })
  // Surfaces the reason when the path settles instead of dispatching.
  expect(listVerificationAttempts(env.db, request.request.id)[0]?.error).toBeNull()
  expect(result).toBe('dispatched')

  // The request settled with evidence, and the check carries an executor-owned outcome.
  const settled = getVerificationRequest(env.db, env.teamId, request.request.id)
  expect(settled?.state).toBe('completed')
  const attempt = listVerificationAttempts(env.db, request.request.id)[0]
  // The first attempt supersedes nothing, and completed with evidence.
  expect(attempt).toMatchObject({ state: 'completed', error: null, supersedesAttemptId: null })
  const outcomes = listVerificationCheckOutcomes(env.db, attempt?.id ?? '')
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ ordinal: 0, state: 'succeeded', exitCode: 0 })

  // The receipt identifies exactly the code, command, environment and outcome.
  const receipt = getCodingCommand(env.db, outcomes[0]?.commandId ?? '')
  expect(receipt).toMatchObject({
    state: 'succeeded',
    exitCode: 0,
    teamId: env.teamId,
    agentId: 'tester',
    turnId: attempt?.id,
  })
  expect(receipt?.input).toMatchObject({
    command: 'sh check.sh',
    cwd: '.',
    purpose: 'verification',
    timeoutSeconds: 30,
  })
  expect(receipt?.environment).toMatchObject({ posture: 'protected', cwd: '.' })
  // The receipt names the snapshot it was verified against — the same code the request captured.
  expect(receipt?.sourceBefore).toMatchObject({
    id: captured.reference.id,
    complete: true,
  })
  // The requesting Agent learns the outcome through the canonical messenger, and the message carries
  // the receipt reference — which is exactly what grants that peer read access to that receipt.
  const inbox = env.db.raw
    .query<{ from_agent_id: string; to_agent_id: string; payload: string }, []>(
      'SELECT from_agent_id, to_agent_id, payload FROM messages',
    )
    .all()
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({ from_agent_id: 'tester', to_agent_id: 'coder' })
  expect(inbox[0]?.payload).toContain(`coding-receipt:${outcomes[0]?.commandId}`)
  expect(inbox[0]?.payload).toContain('completed')
  expect(inbox[0]?.payload).toContain('snapshot')
  // BAZ-045: the result message carries the limits statement from the one definition the web panel
  // also renders, so a limit cannot be stated on one surface and quietly dropped from the other.
  for (const sentence of VERIFICATION_OUTCOME_LIMITS) {
    expect(inbox[0]?.payload).toContain(sentence)
  }
  // Declared output paths are advisory, so the result reports the write outside the declaration
  // instead of implying it was prevented.
  expect(inbox[0]?.payload).toContain('Writes outside the declared output paths (build): stray.txt')

  // Where the checks wrote, relative to the baseline taken under the same lease. `build/out.txt` is
  // covered by the declaration; `stray.txt` is not, and saying so is the whole point of the field.
  expect(attempt?.observedWrites).toMatchObject({
    comparison: 'changed',
    declaredPaths: ['build'],
    undeclaredPaths: ['stray.txt'],
  })
  expect(attempt?.observedWrites?.observedPaths).toEqual(
    expect.arrayContaining(['build/out.txt', 'stray.txt']),
  )

  // The workspace lease is released, so the Team is not left blocked.
  expect(
    env.db.raw.query<{ count: number }, []>('SELECT count(*) AS count FROM workspace_writers').get()
      ?.count,
  ).toBe(0)
})

test('a failing captured check is reported as a failure, not as an error', async () => {
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'fail.sh'), '#!/bin/sh\nexit 4\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-before',
    toolCallId: 'call-before',
    base: 'HEAD',
  })
  const request = captureVerificationRequest(env.db, env.paths, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: captured.reference.id,
    checks: [{ command: 'sh fail.sh', cwd: '.', purpose: 'expected failure', timeoutMs: 30_000 }],
  })
  if (request.kind !== 'captured') throw new Error('expected a captured request')

  expect(
    await dispatchVerificationRequest(request.request.id, {
      workerEntryPath: fileURLToPath(
        new URL('../fixtures/verification-worker-entry.ts', import.meta.url),
      ),
    }),
  ).toBe('dispatched')

  const attempt = listVerificationAttempts(env.db, request.request.id)[0]
  const outcome = listVerificationCheckOutcomes(env.db, attempt?.id ?? '')[0]
  expect(outcome).toMatchObject({ state: 'failed', exitCode: 4 })
  // The attempt completed *with evidence*: a non-zero exit is a result about the change, and the
  // request state says the verification finished rather than that it could not run.
  expect(attempt?.state).toBe('completed')
  expect(getVerificationRequest(env.db, env.teamId, request.request.id)?.state).toBe('completed')
})
