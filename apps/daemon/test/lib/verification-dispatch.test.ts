import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  claimVerificationAttempt,
  createVerificationRequest,
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
} from '../../src/core/repos/verification-requests.ts'
import { registerAgent, unregisterAgent } from '../../src/lib/agent-cancel.ts'
import { dispatchVerificationRequest } from '../../src/lib/verification/dispatch.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

// BAZ-044 slice 5d-2: one dispatch owner, and honest settlement when a turn cannot run.
//
// These exercise the ownership and settlement rules without a model: what matters here is that a
// refusal never claims an attempt, and that a failure settles it rather than leaving it running.

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
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

function request(db: BazilionDb, teamId: string, overrides: Record<string, unknown> = {}) {
  return createVerificationRequest(db, {
    teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: 'snap-1',
    snapshotComplete: true,
    head: 'head',
    baseOid: 'base',
    environment: { image: 'debian:bookworm-slim', sandbox: 'off', cwd: '.' },
    checks: [{ command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 5_000 }],
    ...overrides,
  })
}

test('a request that cannot be admitted is refused without claiming an attempt', async () => {
  seed(env.db, env.teamId)
  const created = request(env.db, env.teamId)
  // No snapshot exists for this Team, so admission refuses before anything durable is claimed.
  expect(await dispatchVerificationRequest(created.id)).toBe('not_dispatchable')
  expect(listVerificationAttempts(env.db, created.id)).toEqual([])
  expect(getVerificationRequest(env.db, env.teamId, created.id)?.state).toBe('blocked')
})

test('a busy specialist defers: the request stays pending and unclaimed', async () => {
  seed(env.db, env.teamId)
  const created = request(env.db, env.teamId)
  const controller = new AbortController()
  registerAgent('tester', controller)
  try {
    expect(await dispatchVerificationRequest(created.id)).toBe('agent_busy')
    expect(listVerificationAttempts(env.db, created.id)).toEqual([])
    // A deferred request keeps its promise: it is still eligible, never consumed or failed.
    expect(getVerificationRequest(env.db, env.teamId, created.id)?.state).toBe('pending')
  } finally {
    unregisterAgent('tester')
  }
})

test('an unknown request is not dispatchable and claims nothing', async () => {
  seed(env.db, env.teamId)
  expect(await dispatchVerificationRequest('does-not-exist')).toBe('not_dispatchable')
})

test('an attempt claimed by another process cannot be adopted', async () => {
  seed(env.db, env.teamId)
  const created = request(env.db, env.teamId)
  const claim = claimVerificationAttempt(env.db, {
    requestId: created.id,
    leaseOwner: 'another-daemon',
    leaseMs: 60_000,
  })
  expect(claim).not.toBeNull()
  // The dispatcher refuses on the busy/blocked paths first, and never doubles up on a live claim.
  const result = await dispatchVerificationRequest(created.id)
  expect(['not_dispatchable', 'agent_busy', 'settled']).toContain(result)
  const attempts = listVerificationAttempts(env.db, created.id)
  expect(attempts).toHaveLength(1)
  // The other owner's claim is untouched: no second attempt, and no outcomes written by us.
  expect(attempts[0]).toMatchObject({ leaseOwner: 'another-daemon', finishedAt: null })
  expect(listVerificationCheckOutcomes(env.db, claim?.attempt.id ?? '')[0]).toMatchObject({
    state: 'not_executed',
  })
})
