import { expect, test } from 'vitest'
import type { BazilionDb } from '../../src/core/db/client.ts'
import {
  claimVerificationAttempt,
  createVerificationRequest,
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  type VerificationRequestRecord,
} from '../../src/core/repos/verification-requests.ts'
import {
  createVerificationHost,
  settleVerificationAttempt,
  type VerificationCheckExecutor,
} from '../../src/lib/verification/runner.ts'
import { VerificationCapabilityError } from '../../src/runtime/tools/verification.ts'
import { makeTestEnv } from '../core/helpers.ts'

// BAZ-044 slice 5b: the daemon side of the capability — captured values only, receipts always.

function seed(env: { db: BazilionDb; teamId: string }): VerificationRequestRecord {
  env.db.raw.run(
    "INSERT INTO profiles (id,name,dir,default_model,created_at,updated_at) VALUES ('profile','Profile','p','lmstudio:model',1,1)",
  )
  for (const id of ['coder', 'tester']) {
    env.db.raw.run(
      `INSERT INTO agents (id, profile_id, name, status, dir, team_id, created_at)
       VALUES (?, 'profile', ?, 'idle', ?, ?, 1)`,
      [id, id, `/tmp/${id}`, env.teamId],
    )
  }
  return createVerificationRequest(env.db, {
    teamId: env.teamId,
    requesterKind: 'agent',
    requesterAgentId: 'coder',
    recipientAgentId: 'tester',
    snapshotId: 'snap-1',
    snapshotComplete: true,
    head: 'head',
    baseOid: 'base',
    environment: {
      image: 'debian:bookworm-slim',
      sandbox: 'docker',
      cwd: '/workspace',
      writablePaths: ['dist'],
    },
    checks: [
      { command: 'pnpm test', cwd: '/workspace', purpose: 'suite', timeoutMs: 5_000 },
      {
        command: 'pnpm test failing',
        cwd: '/workspace',
        purpose: 'expected failure',
        timeoutMs: 5_000,
      },
    ],
  })
}

function executor(
  result: Awaited<ReturnType<VerificationCheckExecutor['run']>> | (() => never),
  seen: Array<{ command: string; cwd: string; timeoutMs: number; purpose: string }> = [],
): VerificationCheckExecutor {
  return {
    async run(input) {
      seen.push(input)
      if (typeof result === 'function') return (result as () => never)()
      return result
    },
  }
}

function hostFor(
  env: { db: BazilionDb },
  request: VerificationRequestRecord,
  attemptId: string,
  checkExecutor: VerificationCheckExecutor,
) {
  return createVerificationHost({
    db: env.db,
    request,
    attemptId,
    executor: checkExecutor,
    applicability: 'identical',
  })
}

test('a check runs with the captured values and records its receipt', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const seen: Array<{ command: string; cwd: string; timeoutMs: number; purpose: string }> = []
    // The receipt must exist: a result may not reference a command that never happened.
    env.db.raw.run(
      `INSERT INTO coding_commands (id, team_id, agent_id, turn_id, tool_call_id, state, created_at, receipt_json)
       VALUES ('cmd-1', ?, 'tester', 'turn', 'call', 'succeeded', 1, '{}')`,
      [env.teamId],
    )
    const host = hostFor(
      env,
      request,
      claim?.attempt.id ?? '',
      executor(
        {
          commandId: 'cmd-1',
          state: 'failed',
          exitCode: 1,
          output: '2 tests failed',
          truncated: false,
        },
        seen,
      ),
    )

    const run = await host.invoke(1)
    expect(run).toMatchObject({ ordinal: 1, state: 'failed', commandId: 'cmd-1', exitCode: 1 })
    // The executed command is the captured one, verbatim — the caller supplied nothing.
    expect(seen).toEqual([
      {
        command: 'pnpm test failing',
        cwd: '/workspace',
        timeoutMs: 5_000,
        purpose: 'verification',
        writablePaths: ['dist'],
      },
    ])
    const outcomes = listVerificationCheckOutcomes(env.db, claim?.attempt.id ?? '')
    expect(outcomes[0]).toMatchObject({ state: 'not_executed' })
    expect(outcomes[1]).toMatchObject({ state: 'failed', commandId: 'cmd-1', exitCode: 1 })
  } finally {
    env.cleanup()
  }
})

test('the daemon is authoritative: undeclared, repeated and receiptless outcomes are refused', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    env.db.raw.run(
      `INSERT INTO coding_commands (id, team_id, agent_id, turn_id, tool_call_id, state, created_at, receipt_json)
       VALUES ('cmd-1', ?, 'tester', 'turn', 'call', 'succeeded', 1, '{}')`,
      [env.teamId],
    )
    const host = hostFor(
      env,
      request,
      attemptId,
      executor({
        commandId: 'cmd-1',
        state: 'succeeded',
        exitCode: 0,
        output: '',
        truncated: false,
      }),
    )
    await expect(host.invoke(7)).rejects.toThrow(/was not captured/)
    await expect(host.invoke(0)).resolves.toMatchObject({ state: 'succeeded' })
    // Settled is settled: the daemon refuses a second run even if the worker asks again.
    await expect(host.invoke(0)).rejects.toThrow(/already reported 'succeeded'/)

    // An executed outcome without a receipt is refused rather than stored with a fabricated id.
    const receiptless = hostFor(
      env,
      request,
      attemptId,
      executor({ commandId: null, state: 'failed', exitCode: 1, output: '', truncated: false }),
    )
    await expect(receiptless.invoke(1)).rejects.toThrow(VerificationCapabilityError)
    expect(
      listVerificationCheckOutcomes(env.db, attemptId).find((row) => row.ordinal === 1),
    ).toMatchObject({ state: 'not_executed' })
  } finally {
    env.cleanup()
  }
})

test('a blocked check is explicit, keeps no receipt, and stays runnable', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    const host = hostFor(
      env,
      request,
      attemptId,
      executor({
        commandId: null,
        state: 'blocked',
        exitCode: null,
        output: 'pnpm is unavailable',
        truncated: false,
        blocker: { reason: 'missing_toolchain', detail: 'pnpm is unavailable' },
      }),
    )
    const run = await host.invoke(0)
    expect(run).toMatchObject({ state: 'blocked', commandId: null, exitCode: null })
    expect(run.output).toContain('pnpm is unavailable')
    expect(listVerificationCheckOutcomes(env.db, attemptId)[0]).toMatchObject({
      state: 'blocked',
      commandId: null,
    })
  } finally {
    env.cleanup()
  }
})

test('settling reports evidence availability, never a verdict about the change', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    env.db.raw.run(
      `INSERT INTO coding_commands (id, team_id, agent_id, turn_id, tool_call_id, state, created_at, receipt_json)
       VALUES ('cmd-1', ?, 'tester', 'turn', 'call', 'failed', 1, '{}')`,
      [env.teamId],
    )
    const host = hostFor(
      env,
      request,
      attemptId,
      executor({ commandId: 'cmd-1', state: 'failed', exitCode: 1, output: '', truncated: false }),
    )
    await host.invoke(0)
    // The specialist never ran the second check.
    const state = settleVerificationAttempt(env.db, {
      attemptId,
      requestId: request.id,
      leaseOwner: 'owner-a',
      now: 5_000,
    })
    // A failing check is a result, not an inability to verify: the attempt completed with evidence.
    expect(state).toBe('completed')
    expect(getVerificationRequest(env.db, env.teamId, request.id)?.state).toBe('completed')
    const outcomes = listVerificationCheckOutcomes(env.db, attemptId)
    // The executed check keeps the time it actually finished; settle only timestamps what it changes.
    expect(outcomes[0]).toMatchObject({ state: 'failed', exitCode: 1 })
    expect(outcomes[0]?.finishedAt).toBeGreaterThan(0)
    // A check the specialist never ran is skipped — distinct from blocked and from unknown.
    expect(outcomes[1]).toMatchObject({ state: 'skipped' })
    expect(listVerificationAttempts(env.db, request.id)[0]).toMatchObject({
      state: 'completed',
      error: null,
    })
  } finally {
    env.cleanup()
  }
})

test('a claimed attempt where nothing ran is a failure to verify, not a result', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const attemptId = claim?.attempt.id ?? ''
    const state = settleVerificationAttempt(env.db, {
      attemptId,
      requestId: request.id,
      leaseOwner: 'owner-a',
      now: 5_000,
    })
    expect(state).toBe('failed')
    expect(getVerificationRequest(env.db, env.teamId, request.id)?.state).toBe('failed')
    expect(listVerificationAttempts(env.db, request.id)[0]?.error).toBe(
      'no captured check executed',
    )
  } finally {
    env.cleanup()
  }
})

test('settling never overwrites a claim another owner holds', async () => {
  const env = makeTestEnv()
  try {
    const request = seed(env)
    const claim = claimVerificationAttempt(env.db, {
      requestId: request.id,
      leaseOwner: 'owner-a',
      leaseMs: 60_000,
    })
    const state = settleVerificationAttempt(env.db, {
      attemptId: claim?.attempt.id ?? '',
      requestId: request.id,
      leaseOwner: 'owner-b',
      now: 5_000,
    })
    expect(state).toBe('uncertain')
    // The real owner can still settle it.
    expect(listVerificationAttempts(env.db, request.id)[0]?.finishedAt).toBeNull()
  } finally {
    env.cleanup()
  }
})
