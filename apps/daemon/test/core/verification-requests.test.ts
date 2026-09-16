import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  claimVerificationAttempt,
  createVerificationRequest,
  finishVerificationAttempt,
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  listVerificationChecks,
  listVerificationRequests,
  pruneVerificationRequests,
  recordVerificationCheckOutcome,
  recoverInterruptedVerificationAttempts,
  setRequestState,
  VERIFICATION_MAX_CHECKS,
  VERIFICATION_REQUEST_TTL_MS,
  VerificationRequestError,
  type VerificationRequestInput,
} from '../../src/core/repos/verification-requests.ts'
import { makeTestEnv } from './helpers.ts'

/** The regression below needs exactly one declared check, matching its outcome ordinal. */
const checkOnly = { command: 'pnpm test', cwd: '/workspace', purpose: 'suite', timeoutMs: 120_000 }

// BAZ-044 slice 1: the typed, snapshot-bound specialist verification request.
//
// The properties under test are the ones the rest of the story rests on: a request is bounded and
// immutable, exactly one owner may claim it, an interrupted claim is `uncertain` rather than
// replayed, and executor facts are written once by the executing attempt.

function seedAgents(db: BazilionDb, teamId: string): void {
  db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const [id, name] of [
    ['coder', 'Coder'],
    ['tester', 'Tester'],
  ]) {
    db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, name, `/tmp/${id}`, teamId],
    )
  }
}

function seedCommandReceipt(db: BazilionDb, teamId: string, id: string): void {
  db.raw.run(
    `INSERT INTO coding_commands (id, team_id, agent_id, turn_id, tool_call_id, state, created_at, receipt_json)
     VALUES (?, ?, 'tester', 'turn-1', ?, 'succeeded', 1, '{}')`,
    [id, teamId, `call-${id}`],
  )
}

function input(
  teamId: string,
  overrides: Partial<VerificationRequestInput> = {},
): VerificationRequestInput {
  return {
    id: 'req-1',
    teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    sourceSessionId: 'session-1',
    snapshotId: 'snap-1',
    snapshotComplete: true,
    head: 'head-oid',
    baseOid: 'base-oid',
    environment: { image: 'debian:bookworm-slim', sandbox: 'docker', cwd: '/workspace' },
    summary: 'verify the fix',
    checks: [
      { command: 'pnpm test', cwd: '/workspace', purpose: 'full suite', timeoutMs: 120_000 },
      {
        command: 'pnpm test failing',
        cwd: '/workspace',
        purpose: 'expected failure',
        timeoutMs: 60_000,
      },
    ],
    ...overrides,
  }
}

test('a request round-trips with its captured checks and environment facts', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    const now = 1_000_000
    const request = createVerificationRequest(env.db, input(env.teamId, { now }))
    expect(request).toMatchObject({
      id: 'req-1',
      teamId: env.teamId,
      requesterKind: 'agent',
      requesterAgentId: 'coder',
      recipientAgentId: 'tester',
      snapshotId: 'snap-1',
      snapshotComplete: true,
      state: 'pending',
      createdAt: now,
      expiresAt: now + VERIFICATION_REQUEST_TTL_MS,
    })
    expect(request.environment).toEqual({
      image: 'debian:bookworm-slim',
      sandbox: 'docker',
      cwd: '/workspace',
    })
    const checks = listVerificationChecks(env.db, 'req-1')
    expect(checks.map((check) => check.ordinal)).toEqual([0, 1])
    expect(checks[0]).toMatchObject({
      command: 'pnpm test',
      cwd: '/workspace',
      purpose: 'full suite',
      timeoutMs: 120_000,
    })
    // The captured contract carries no outcome: those belong to an attempt.
    expect(checks[0]).not.toHaveProperty('state')
  } finally {
    env.cleanup()
  }
})

test('an operator request has no requester Agent', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    const request = createVerificationRequest(
      env.db,
      input(env.teamId, {
        requesterKind: 'operator',
        requesterAgentId: null,
        sourceSessionId: null,
      }),
    )
    expect(request.requesterKind).toBe('operator')
    expect(request.requesterAgentId).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('a request is bounded before anything is written', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    const check = { command: 'pnpm test', cwd: '.', purpose: 'suite', timeoutMs: 5_000 }
    const rejects: Array<[Partial<VerificationRequestInput>, string]> = [
      [{ checks: [] }, 'needs at least one check'],
      [
        { checks: Array.from({ length: VERIFICATION_MAX_CHECKS + 1 }, () => check) },
        'at most 8 checks',
      ],
      [{ checks: [{ ...check, command: '   ' }] }, 'requires a command'],
      [{ checks: [{ ...check, purpose: '' }] }, 'requires a purpose'],
      [{ checks: [{ ...check, timeoutMs: 999 }] }, 'timeout is outside its bounded contract'],
      [{ checks: [{ ...check, timeoutMs: 300_001 }] }, 'timeout is outside its bounded contract'],
      [{ summary: ' '.repeat(4) }, 'summary must not be empty'],
      [{ summary: 'x'.repeat(2_001) }, 'summary is outside its bounded contract'],
      [{ snapshotId: '' }, 'requires a captured snapshot'],
      [{ baseOid: '' }, 'requires a captured base'],
      [{ recipientAgentId: 'coder', requesterAgentId: 'coder' }, 'cannot verify its own request'],
      [{ requesterAgentId: null }, 'names its requester'],
      [{ requesterKind: 'operator' }, 'operator request has no requester Agent'],
      [{ environment: { image: '', sandbox: 'off' } }, 'no image'],
      [{ environment: { image: 'x', sandbox: 'vm' as never } }, 'unknown shell backend'],
    ]
    for (const [override, message] of rejects) {
      expect(() => createVerificationRequest(env.db, input(env.teamId, override))).toThrow(message)
    }
    // Nothing partial survived the rejections.
    expect(listVerificationRequests(env.db, env.teamId)).toHaveLength(0)
    const row = env.db.raw
      .query<{ count: number }, []>('SELECT count(*) AS count FROM verification_checks')
      .get()
    expect(row?.count).toBe(0)
  } finally {
    env.cleanup()
  }
})

test('a request reads only inside its Team and only inside its window', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    const now = 1_000_000
    createVerificationRequest(env.db, input(env.teamId, { now }))
    expect(getVerificationRequest(env.db, env.teamId, 'req-1', now)).not.toBeNull()
    expect(getVerificationRequest(env.db, 'other-team', 'req-1', now)).toBeNull()
    const expired = now + VERIFICATION_REQUEST_TTL_MS
    expect(getVerificationRequest(env.db, env.teamId, 'req-1', expired + 1)).toBeNull()
    expect(listVerificationRequests(env.db, env.teamId, 50, expired + 1)).toHaveLength(0)
    expect(pruneVerificationRequests(env.db, expired + 1)).toBe(1)
  } finally {
    env.cleanup()
  }
})

test('exactly one owner may claim a request', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const lease = { requestId: 'req-1', leaseOwner: 'daemon-a', leaseMs: 60_000, now: 10 }
    const claim = claimVerificationAttempt(env.db, lease)
    expect(claim?.attempt).toMatchObject({
      attemptNumber: 1,
      state: 'claimed',
      leaseOwner: 'daemon-a',
      supersedesAttemptId: null,
    })
    expect(claim?.state).toBe('running')
    expect(getVerificationRequest(env.db, env.teamId, 'req-1')?.state).toBe('running')
    // A second owner cannot take the open slot, whatever name it uses.
    expect(claimVerificationAttempt(env.db, { ...lease, leaseOwner: 'daemon-b' })).toBeNull()
    // The claim created one outcome row per declared check, all unsettled.
    const outcomes = listVerificationCheckOutcomes(env.db, claim?.attempt.id ?? '')
    expect(outcomes.map((outcome) => outcome.state)).toEqual(['not_executed', 'not_executed'])
  } finally {
    env.cleanup()
  }
})

test('a claim is refused for a held or finished request unless it is an explicit rerun', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const lease = { requestId: 'req-1', leaseOwner: 'daemon-a', leaseMs: 60_000 }
    setRequestState(env.db, 'req-1', 'awaiting_approval')
    expect(claimVerificationAttempt(env.db, lease)).toBeNull()
    setRequestState(env.db, 'req-1', 'completed')
    expect(claimVerificationAttempt(env.db, lease)).toBeNull()
    const rerun = claimVerificationAttempt(env.db, { ...lease, rerun: true })
    expect(rerun?.attempt.attemptNumber).toBe(1)
    expect(
      finishVerificationAttempt(env.db, {
        attemptId: rerun?.attempt.id ?? '',
        leaseOwner: 'daemon-a',
        state: 'completed',
      }),
    ).toBe(true)
    // An unknown request is never claimable.
    expect(claimVerificationAttempt(env.db, { ...lease, requestId: 'nope' })).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('an explicit rerun is a new attempt that supersedes the previous result', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const first = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-a',
      leaseMs: 60_000,
      now: 10,
    })
    expect(first).not.toBeNull()
    expect(
      finishVerificationAttempt(env.db, {
        attemptId: first?.attempt.id ?? '',
        leaseOwner: 'daemon-a',
        state: 'failed',
        error: 'check 2 exited 1',
        now: 20,
      }),
    ).toBe(true)
    // The previous attempt keeps its own history.
    const second = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-a',
      leaseMs: 60_000,
      rerun: true,
      now: 30,
    })
    expect(second?.attempt.attemptNumber).toBe(2)
    expect(second?.attempt.supersedesAttemptId).toBe(first?.attempt.id)
    const attempts = listVerificationAttempts(env.db, 'req-1')
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({
      state: 'failed',
      error: 'check 2 exited 1',
      finishedAt: 20,
    })
    expect(attempts[1]?.finishedAt).toBeNull()
    // A fresh attempt starts from fresh outcomes rather than the previous run's facts.
    expect(
      listVerificationCheckOutcomes(env.db, second?.attempt.id ?? '').map((row) => row.state),
    ).toEqual(['not_executed', 'not_executed'])
  } finally {
    env.cleanup()
  }
})

test('only the lease owner may advance or finish a claim', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const claim = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    expect(
      finishVerificationAttempt(env.db, { attemptId, leaseOwner: 'daemon-b', state: 'completed' }),
    ).toBe(false)
    expect(
      finishVerificationAttempt(env.db, { attemptId, leaseOwner: 'daemon-a', state: 'failed' }),
    ).toBe(true)
    // A settled attempt cannot be settled twice, so a late writer cannot rewrite the outcome.
    expect(
      finishVerificationAttempt(env.db, { attemptId, leaseOwner: 'daemon-a', state: 'completed' }),
    ).toBe(false)
    expect(listVerificationAttempts(env.db, 'req-1')[0]?.state).toBe('failed')
    expect(getVerificationRequest(env.db, env.teamId, 'req-1')?.state).toBe('failed')
  } finally {
    env.cleanup()
  }
})

test('check outcomes are executor-owned, recorded once, and receipt-backed', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    seedCommandReceipt(env.db, env.teamId, 'cmd-1')
    const claim = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    // An executed outcome must name the receipt that produced it.
    expect(() =>
      recordVerificationCheckOutcome(env.db, { attemptId, ordinal: 0, state: 'succeeded' }),
    ).toThrow('requires the receipt')
    // A receipt reference must be a receipt that exists: provenance is never fabricated.
    expect(() =>
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 0,
        state: 'succeeded',
        commandId: 'never-ran',
        exitCode: 0,
      }),
    ).toThrow('FOREIGN KEY')
    // A non-executed outcome must not claim one, and only executed checks carry an exit code.
    expect(() =>
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 1,
        state: 'blocked',
        commandId: 'cmd-1',
      }),
    ).toThrow('cannot claim a command receipt')
    expect(() =>
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 1,
        state: 'skipped',
        exitCode: 0,
      }),
    ).toThrow('exit code')
    // The outcome cannot return to not_executed.
    expect(() =>
      recordVerificationCheckOutcome(env.db, { attemptId, ordinal: 0, state: 'not_executed' }),
    ).toThrow('cannot return to not_executed')

    expect(
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 0,
        state: 'failed',
        commandId: 'cmd-1',
        exitCode: 1,
        finishedAt: 99,
      }),
    ).toBe(true)
    // Written once: a second write for the same ordinal is refused.
    expect(
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 0,
        state: 'succeeded',
        commandId: 'cmd-2',
        exitCode: 0,
      }),
    ).toBe(false)
    // An ordinal that was never declared cannot be recorded.
    expect(
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 5,
        state: 'skipped',
      }),
    ).toBe(false)
    const outcomes = listVerificationCheckOutcomes(env.db, attemptId)
    expect(outcomes[0]).toMatchObject({
      state: 'failed',
      commandId: 'cmd-1',
      exitCode: 1,
      finishedAt: 99,
    })
    expect(outcomes[1]?.state).toBe('not_executed')
  } finally {
    env.cleanup()
  }
})

test('an interrupted claim becomes uncertain and is never replayed', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const claim = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-before-restart',
      leaseMs: 60_000,
      now: 10,
    })
    const attemptId = claim?.attempt.id ?? ''
    seedCommandReceipt(env.db, env.teamId, 'cmd-1')
    recordVerificationCheckOutcome(env.db, {
      attemptId,
      ordinal: 0,
      state: 'succeeded',
      commandId: 'cmd-1',
      exitCode: 0,
    })

    // A fresh daemon process settles the abandoned claim as uncertain.
    const recovered = recoverInterruptedVerificationAttempts(env.db, 'daemon-after-restart', 20)
    expect(recovered).toEqual(['req-1'])
    expect(listVerificationAttempts(env.db, 'req-1')[0]).toMatchObject({
      state: 'uncertain',
      finishedAt: 20,
      leaseOwner: null,
    })
    // The check that never reported is unknown; the one that did keeps its receipt.
    const outcomes = listVerificationCheckOutcomes(env.db, attemptId)
    expect(outcomes[0]).toMatchObject({ state: 'succeeded', commandId: 'cmd-1' })
    expect(outcomes[1]?.state).toBe('unknown')
    expect(getVerificationRequest(env.db, env.teamId, 'req-1')?.state).toBe('uncertain')
    // Recovery does not re-open the request: nothing will run it again by itself.
    expect(
      claimVerificationAttempt(env.db, {
        requestId: 'req-1',
        leaseOwner: 'daemon-after-restart',
        leaseMs: 60_000,
      }),
    ).toBeNull()
  } finally {
    env.cleanup()
  }
})

test('recovery leaves this process own live claim alone', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    const claim = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'daemon-live',
      leaseMs: 60_000,
    })
    expect(recoverInterruptedVerificationAttempts(env.db, 'daemon-live', 20)).toEqual([])
    expect(listVerificationAttempts(env.db, 'req-1')[0]?.state).toBe('claimed')
    expect(getVerificationRequest(env.db, env.teamId, 'req-1')?.state).toBe('running')
    expect(
      finishVerificationAttempt(env.db, {
        attemptId: claim?.attempt.id ?? '',
        leaseOwner: 'daemon-live',
        state: 'completed',
      }),
    ).toBe(true)
  } finally {
    env.cleanup()
  }
})

test('an invalid claim owner or lease is refused', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    createVerificationRequest(env.db, input(env.teamId))
    expect(() =>
      claimVerificationAttempt(env.db, { requestId: 'req-1', leaseOwner: '', leaseMs: 1 }),
    ).toThrow(VerificationRequestError)
    expect(() =>
      claimVerificationAttempt(env.db, { requestId: 'req-1', leaseOwner: 'a', leaseMs: 0 }),
    ).toThrow('positive lease')
  } finally {
    env.cleanup()
  }
})

// Regression (review S1): a verification outcome must not make receipt pruning impossible.
//
// `command_id` is ON DELETE SET NULL, so a *required-non-null* rule for executed states made the delete
// violate the outcome table's CHECK. `saveCodingCommand` prunes on every save, so that failure spread to
// every later receipt in the Team — found by probe, guarded here.
test('pruning a coding receipt leaves the verification outcome readable', () => {
  const env = makeTestEnv()
  try {
    seedAgents(env.db, env.teamId)
    env.db.raw.run(
      "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('p2','P2','p','lmstudio:m',1,1) ON CONFLICT DO NOTHING",
    )
    createVerificationRequest(env.db, input(env.teamId, { checks: [checkOnly] }))
    const claim = claimVerificationAttempt(env.db, {
      requestId: 'req-1',
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    seedCommandReceipt(env.db, env.teamId, 'cmd-kept')
    expect(
      recordVerificationCheckOutcome(env.db, {
        attemptId,
        ordinal: 0,
        state: 'succeeded',
        commandId: 'cmd-kept',
        exitCode: 0,
      }),
    ).toBe(true)

    // Deleting the referenced receipt must succeed, and must not fail a CHECK.
    expect(() =>
      env.db.raw.run('DELETE FROM coding_commands WHERE id = ?', ['cmd-kept']),
    ).not.toThrow()

    // The outcome keeps the executor's facts, and simply reports that its receipt is gone.
    const outcome = listVerificationCheckOutcomes(env.db, attemptId)[0]
    expect(outcome).toMatchObject({ state: 'succeeded', exitCode: 0, commandId: null })
  } finally {
    env.cleanup()
  }
})
