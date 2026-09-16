import type { VerificationBlocker, VerificationCheckState } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import {
  finishVerificationAttempt,
  listVerificationCheckOutcomes,
  listVerificationChecks,
  recordVerificationCheckOutcome,
  setRequestState,
  type VerificationRequestRecord,
} from '../../core/repos/verification-requests.ts'
import type {
  VerificationBrief,
  VerificationBriefCheck,
  VerificationCapabilityHost,
  VerificationCheckRun,
} from '../../runtime/tools/verification.ts'
import { VerificationCapabilityError } from '../../runtime/tools/verification.ts'

// BAZ-044: the daemon side of the specialist capability.
//
// This is where the captured contract meets execution, and it is the authority for three rules the
// worker also enforces: only declared ordinals run, each runs once, and every reported outcome
// carries the receipt that produced it. Nothing here accepts a command, cwd, timeout or environment
// from the caller — the captured values are used verbatim, so the specialist cannot widen the run.

/** A protected-shell execution result, as the daemon-side executor reports it. */
export interface VerificationCheckExecutorResult {
  /** BAZ-041 receipt id; absent only when nothing was executed. */
  commandId: string | null
  state: 'succeeded' | 'failed' | 'blocked' | 'timed_out' | 'cancelled'
  exitCode: number | null
  output: string
  truncated: boolean
  /** Why a check could not run, for the explicit-blocker path. */
  blocker?: VerificationBlocker
}

export interface VerificationCheckExecutor {
  /**
   * Run one captured command through the existing protected shell path, honouring approvals,
   * cancellation, isolation and output policy. The executor receives only captured values.
   */
  run(input: {
    command: string
    cwd: string
    timeoutMs: number
    purpose: 'verification'
    writablePaths: readonly string[]
    signal?: AbortSignal
  }): Promise<VerificationCheckExecutorResult>
}

export interface VerificationHostInput {
  db: BazilionDb
  request: VerificationRequestRecord
  attemptId: string
  executor: VerificationCheckExecutor
  applicability: 'identical' | 'changed' | 'unknown'
}

/** Build the host bound to one claimed attempt. */
export function createVerificationHost(input: VerificationHostInput): VerificationCapabilityHost {
  const { db, request, attemptId, executor } = input

  return {
    async read(): Promise<VerificationBrief> {
      const declared = listVerificationChecks(db, request.id)
      const outcomes = new Map(
        listVerificationCheckOutcomes(db, attemptId).map((outcome) => [outcome.ordinal, outcome]),
      )
      const checks: VerificationBriefCheck[] = declared.map((check) => {
        const outcome = outcomes.get(check.ordinal)
        return {
          ordinal: check.ordinal,
          command: check.command,
          cwd: check.cwd,
          purpose: check.purpose,
          timeoutMs: check.timeoutMs,
          state: outcome?.state ?? 'not_executed',
          commandId: outcome?.commandId ?? null,
          exitCode: outcome?.exitCode ?? null,
        }
      })
      return {
        requestId: request.id,
        summary: request.summary,
        snapshot: {
          id: request.snapshotId,
          complete: request.snapshotComplete,
          head: request.head,
          baseOid: request.baseOid,
        },
        environment: {
          image: request.environment.image,
          sandbox: request.environment.sandbox,
          ...(request.environment.cwd ? { cwd: request.environment.cwd } : {}),
        },
        writablePaths: request.environment.writablePaths ?? [],
        checks,
        applicability: input.applicability,
      }
    },

    async invoke(ordinal: number): Promise<VerificationCheckRun> {
      const declared = listVerificationChecks(db, request.id).find(
        (check) => check.ordinal === ordinal,
      )
      // The declared set is the authority: an ordinal that was never captured cannot be run here,
      // and there is no argument that could substitute a different command.
      if (!declared) {
        throw new VerificationCapabilityError(`check ${ordinal} was not captured with this request`)
      }
      const settled = listVerificationCheckOutcomes(db, attemptId).find(
        (outcome) => outcome.ordinal === ordinal,
      )
      if (settled && settled.state !== 'not_executed') {
        throw new VerificationCapabilityError(
          `check ${ordinal} already reported '${settled.state}' and cannot be run again`,
        )
      }

      const startedAt = Date.now()
      let result: VerificationCheckExecutorResult
      try {
        result = await executor.run({
          command: declared.command,
          cwd: declared.cwd,
          timeoutMs: declared.timeoutMs,
          purpose: 'verification',
          writablePaths: request.environment.writablePaths ?? [],
        })
      } catch (error) {
        // A throwing executor reported no outcome. The check keeps `not_executed` so it stays
        // runnable, and the reason is surfaced rather than converted into a fabricated failure.
        throw error instanceof Error ? error : new Error('verification check failed to start')
      }

      const state = normalizeState(result.state)
      // An executed outcome must name its receipt and a non-executed one must not. The store
      // enforces this too; checking here keeps the refusal close to the executor contract.
      if (state !== 'blocked' && !result.commandId) {
        throw new VerificationCapabilityError(
          `a ${state} check must report the receipt that produced it`,
        )
      }
      const recorded = recordVerificationCheckOutcome(db, {
        attemptId,
        ordinal,
        state,
        commandId: state === 'blocked' ? null : result.commandId,
        exitCode: state === 'succeeded' || state === 'failed' ? result.exitCode : null,
        startedAt,
        finishedAt: Date.now(),
      })
      if (!recorded) {
        throw new VerificationCapabilityError(`check ${ordinal} was already settled`)
      }
      return {
        ordinal,
        state,
        commandId: state === 'blocked' ? null : result.commandId,
        exitCode: state === 'succeeded' || state === 'failed' ? result.exitCode : null,
        output: result.output,
        truncated: result.truncated,
      }
    },
  }
}

function normalizeState(state: VerificationCheckExecutorResult['state']): VerificationCheckState {
  return state
}

/**
 * Settle a claimed attempt from the outcomes it recorded.
 *
 * `completed` means the check set finished and its evidence is available — **not** that the change
 * passed. A failing test is a legitimate verification result, reported per check; conflating it with
 * "the verification could not run" would erase the distinction the story requires. Checks the
 * specialist never ran are `skipped`, which is distinct from `blocked` (could not run) and `unknown`
 * (interrupted), so a partial run never reads as a full one.
 */
export function settleVerificationAttempt(
  db: BazilionDb,
  input: { attemptId: string; requestId: string; leaseOwner: string; now?: number },
): 'completed' | 'failed' | 'uncertain' {
  const now = input.now ?? Date.now()
  // Gate ownership *before* mutating anything: `finishVerificationAttempt` re-checks inside its
  // transaction, but by then the skipped-marking below would already have touched another owner's
  // attempt. A mismatched owner must leave the attempt exactly as it found it.
  const owned = db.raw
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM verification_attempts
       WHERE id = ? AND lease_owner = ? AND finished_at IS NULL`,
    )
    .get(input.attemptId, input.leaseOwner)
  if (!owned) return 'uncertain'
  const declared = listVerificationChecks(db, input.requestId)
  const outcomes = new Map(
    listVerificationCheckOutcomes(db, input.attemptId).map((outcome) => [outcome.ordinal, outcome]),
  )
  for (const check of declared) {
    const outcome = outcomes.get(check.ordinal)
    if (!outcome || outcome.state === 'not_executed') {
      db.raw.run(
        `UPDATE verification_check_outcomes SET state = 'skipped', finished_at = ?
         WHERE attempt_id = ? AND ordinal = ? AND state = 'not_executed'`,
        [now, input.attemptId, check.ordinal],
      )
    }
  }
  const settled = listVerificationCheckOutcomes(db, input.attemptId)
  const executed = settled.filter((outcome) =>
    ['succeeded', 'failed'].includes(outcome.state),
  ).length
  // Nothing ran at all: the verification did not happen, so it is a failure of the attempt rather
  // than a result about the change.
  const state: 'completed' | 'failed' = executed > 0 ? 'completed' : 'failed'
  const error = state === 'failed' ? 'no captured check executed' : null
  const finished = finishVerificationAttempt(db, {
    attemptId: input.attemptId,
    leaseOwner: input.leaseOwner,
    state,
    error,
    now,
  })
  if (!finished) {
    // Another owner settled it, or the lease was recovered as uncertain. Do not overwrite that.
    return 'uncertain'
  }
  setRequestState(db, input.requestId, state)
  return state
}

/**
 * Abandon a claimed attempt whose turn was cancelled or failed before it could report.
 *
 * Distinct from `settleVerificationAttempt`: nothing was verified, so the attempt is `cancelled` or
 * `failed` and its unreported checks are left `not_executed` rather than turned into results. An
 * interrupted process keeps the store's `uncertain` semantics instead, because there the work may
 * have happened.
 */
export function abandonVerificationAttempt(
  db: BazilionDb,
  input: {
    attemptId: string
    requestId: string
    leaseOwner: string
    state: 'cancelled' | 'failed'
    error: string
    now?: number
  },
): boolean {
  const now = input.now ?? Date.now()
  const finished = finishVerificationAttempt(db, {
    attemptId: input.attemptId,
    leaseOwner: input.leaseOwner,
    state: input.state,
    error: input.error,
    now,
  })
  if (!finished) return false
  db.raw.run(
    `UPDATE verification_check_outcomes
     SET state = 'unknown', finished_at = ?
     WHERE attempt_id = ? AND state = 'not_executed'`,
    [now, input.attemptId],
  )
  setRequestState(db, input.requestId, input.state)
  return true
}
