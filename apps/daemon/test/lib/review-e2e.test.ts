import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  getReviewPacket,
  listReviewAttempts,
  listReviewConclusions,
  listReviewFindings,
} from '../../src/core/repos/review-packets.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import { captureTeamSnapshot } from '../../src/lib/git-review/service.ts'
import { captureReviewPacket } from '../../src/lib/review/capture.ts'
import { dispatchReviewPacket } from '../../src/lib/review/dispatch.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-043 criterion 2, observed end to end without a model: capture a packet against a real dirty change,
// dispatch the reviewer, and read back the findings and conclusion the restricted turn produced.
//
// The fixture worker performs only what the capability allows — read the packet, read a patch, record a
// finding, conclude — and also *attempts* the capabilities a reviewer must not have, so the read-only
// guarantee is observed rather than asserted from a tool list.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
// The model runtime is stubbed: the fixture worker never opens a session, so this observes the
// dispatch → capability → IPC → settle path with no provider and no model in the loop.
vi.mock('../../src/lib/protected-provider.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/protected-provider.ts')>()),
  resolveProtectedProviderRuntime: async () => ({
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

const workerEntryPath = fileURLToPath(
  new URL('../fixtures/review-worker-entry.ts', import.meta.url),
)

test('a captured change is reviewed end to end, and the reviewer reaches nothing it was not granted', async () => {
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')

  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-before',
    toolCallId: 'call-before',
    base: 'HEAD',
  })
  const captureResult = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    summary: 'the new branch is untested',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (captureResult.kind !== 'captured') throw new Error('capture blocked')
  const packetId = captureResult.packet.id
  // The tree before the review, so "the review changed nothing" is a comparison rather than a guess.
  const beforeReview = git(env, 'status', '--porcelain')

  const outcome = await dispatchReviewPacket(packetId, { workerEntryPath })
  expect(outcome).toBe('dispatched')

  // The attempt settled as a completed review, because the reviewer recorded a conclusion.
  expect(listReviewAttempts(env.db, packetId)[0]).toMatchObject({ state: 'completed', error: null })
  expect(getReviewPacket(env.db, packetId)?.state).toBe('reviewed')

  // The finding is the reviewer's, about the *captured revision*, with line context only.
  const findings = listReviewFindings(env.db, packetId)
  expect(findings).toHaveLength(1)
  expect(findings[0]).toMatchObject({
    authorKind: 'agent',
    authorAgentId: 'reviewer',
    path: 'app.txt',
    severity: 'major',
    state: 'open',
    snapshotId: captured.reference.id,
    lineStart: 3,
    lineEnd: 3,
  })
  expect(listReviewConclusions(env.db, packetId)[0]).toMatchObject({
    conclusion: 'changes_requested',
    reviewerAgentId: 'reviewer',
    snapshotId: captured.reference.id,
  })

  // The review never touched the change it was asked about: no write, no commit, no staging.
  expect(readFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'utf8')).toBe(
    'one\ntwo\nthree\n',
  )
  expect(git(env, 'status', '--porcelain')).toBe(beforeReview)

  // The requester was told, through the canonical messenger, and the message says what the review is not.
  const inbox = env.db.raw
    .query<{ from_agent_id: string; to_agent_id: string; payload: string }, []>(
      'SELECT from_agent_id, to_agent_id, payload FROM messages',
    )
    .all()
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({ from_agent_id: 'reviewer', to_agent_id: 'coder' })
  expect(inbox[0]?.payload).toContain('changes_requested')
  expect(inbox[0]?.payload).toContain('the new branch has no test')
  expect(inbox[0]?.payload).toContain('not operator acceptance')
})

test('a reviewer that finishes without concluding has not reviewed anything', async () => {
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'operator',
    base: 'HEAD',
  })
  const captureResult = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (captureResult.kind !== 'captured') throw new Error('capture blocked')
  const packetId = captureResult.packet.id

  // A worker that reads the packet and stops: the attempt is a failure with a reason, and the packet goes
  // back to `open` rather than reading as a review.
  const silence = fileURLToPath(
    new URL('../fixtures/review-silent-worker-entry.ts', import.meta.url),
  )
  // `dispatched` means an attempt ran, whatever it settled as — the failed attempt below is the point.
  const outcome = await dispatchReviewPacket(packetId, { workerEntryPath: silence })
  expect(outcome).toBe('dispatched')
  expect(listReviewAttempts(env.db, packetId)[0]).toMatchObject({
    state: 'failed',
    error: 'the reviewer finished without recording a conclusion',
  })
  expect(getReviewPacket(env.db, packetId)?.state).toBe('open')
  expect(listReviewConclusions(env.db, packetId)).toHaveLength(0)
  // Nothing was delivered: there is no review outcome to report.
  expect(env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM messages').get()?.n).toBe(0)
})

// BAZ-045: the read-only claim observed in the configuration that *turns execution on*. The claim is
// true by construction — `spawnWorker` clears the container, coding, browser, MCP and messaging hosts
// for every restricted kind — but "true by construction" is exactly what BAZ-044's review found hiding
// two unwired guards. So this observes it: the reviewer still cannot reach anything, and the run
// creates no container and holds no workspace writer while the sandbox mode is active.
test('a review turn runs nothing, with container isolation switched on', async () => {
  seed(env.db, env.teamId)
  git(env, 'init', '-q', '-b', 'main')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\n')
  git(env, 'add', '.')
  git(env, 'commit', '-qm', 'base')
  writeFileSync(join(env.paths.teamDir(env.teamId), 'app.txt'), 'one\ntwo\nthree\n')
  const captured = await captureTeamSnapshot(env.db, env.paths, env.teamId, {
    capturedBy: 'agent',
    agentId: 'coder',
    turnId: 'turn-before',
    toolCallId: 'call-before',
    base: 'HEAD',
  })
  const captureResult = captureReviewPacket(env.db, env.paths, {
    teamId: env.teamId,
    snapshotId: captured.reference.id,
    reviewerAgentId: 'reviewer',
    summary: 'the new branch is untested',
    requesterKind: 'agent',
    requesterAgentId: 'coder',
  })
  if (captureResult.kind !== 'captured') throw new Error('capture blocked')

  const previous = process.env.BAZILION_BASH_SANDBOX
  process.env.BAZILION_BASH_SANDBOX = 'docker'
  let outcome: string
  try {
    outcome = await dispatchReviewPacket(captureResult.packet.id, { workerEntryPath })
  } finally {
    if (previous === undefined) delete process.env.BAZILION_BASH_SANDBOX
    else process.env.BAZILION_BASH_SANDBOX = previous
  }

  // The turn really ran — a completion here is the fixture's own assertion that every capability a
  // reviewer must not have was refused by the daemon, container and coding ones included.
  expect(outcome).toBe('dispatched')
  expect(listReviewAttempts(env.db, captureResult.packet.id)[0]).toMatchObject({
    state: 'completed',
    error: null,
  })

  // And it created nothing: no container registered against any workspace writer, and no writer left
  // behind holding the Team tree.
  const resources = env.db.raw
    .query<{ kind: string }, []>('SELECT kind FROM workspace_resources')
    .all()
  expect(resources.filter((row) => row.kind === 'container')).toEqual([])
  const writers = env.db.raw
    .query<{ state: string }, []>('SELECT state FROM workspace_writers')
    .all()
  expect(writers.filter((row) => row.state === 'active')).toEqual([])

  // Control: the same measurement, pointed at a container that does exist. Without this, "no container"
  // could be an assertion that is simply always true — the failure mode this story exists to stop. The
  // control covers the *read* only; it deletes its own rows rather than tearing down a container that
  // never existed, because confirming that cleanup needs real Docker and this test must not.
  const lease = await workspaceLifecycle(env.db).claim(
    env.teamId,
    env.paths.teamDir(env.teamId),
    'agent',
  )
  const containers = workspaceLifecycle(env.db).containers(lease)
  const controlName = containers.name('bash')
  const containerRows = () =>
    env.db.raw
      .query<{ kind: string }, []>('SELECT kind FROM workspace_resources')
      .all()
      .filter((row) => row.kind === 'container')
  await containers.beforeCreate({
    dockerPath: '/usr/bin/docker',
    endpoint: 'unix:///var/run/docker.sock',
    executableIdentity: {
      device: '2065',
      inode: '2',
      mode: '100755',
      size: '0',
      modifiedTimeNs: '0',
      changedTimeNs: '0',
    },
    containerName: controlName,
  })
  expect(containerRows()).toHaveLength(1)
  env.db.raw.run('DELETE FROM workspace_resources')
  env.db.raw.run('DELETE FROM workspace_writers')
  expect(containerRows()).toEqual([])
})
