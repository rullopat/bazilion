import { VERIFICATION_OUTCOME_LIMITS } from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import type {
  VerificationAttemptRecord,
  VerificationRequestRecord,
} from '../../core/repos/verification-requests.ts'
import {
  listVerificationCheckOutcomes,
  listVerificationChecks,
} from '../../core/repos/verification-requests.ts'
import { sendAgentMessage } from '../communication.ts'

// BAZ-044: hand the result back to the requesting Agent.
//
// Without this the loop is incomplete: a coder requests verification and yields, so a result that only
// exists on the operator surfaces can never reach the agent that asked. Delivery goes through the
// canonical messenger, which means Team Policy applies to it like any other peer message.
//
// The message carries `coding-receipt:<id>` references, and BAZ-040's authorized peer-read path is
// exactly what grants a peer access to a receipt it was sent — so this is the bounded, per-request
// access the story asks for, rather than a new sharing mechanism or a general opening of the result
// library. A refused or held delivery never fails the verification: the evidence stays readable by its
// owner and by the operator.

/** Bounded, so a long check list cannot turn into an oversized peer message. */
const MAX_RESULT_CHARACTERS = 4_000

export interface VerificationResultInput {
  db: BazilionDb
  paths: Paths
  request: VerificationRequestRecord
  attempt: VerificationAttemptRecord
  /** How the attempt ended, in the operator's vocabulary. */
  outcome: 'completed' | 'failed' | 'cancelled' | 'uncertain'
  /** Applicability *now*, or null when it could not be established. */
  applicability: 'identical' | 'changed' | 'unknown' | null
}

/**
 * Send the outcome to the requesting Agent, if the requester was an Agent.
 *
 * Returns whether a message was handed to the messenger, for tests and diagnostics. Never throws.
 */
export function deliverVerificationResult(input: VerificationResultInput): boolean {
  const { request } = input
  if (request.requesterKind !== 'agent' || !request.requesterAgentId) return false
  const payload = renderResult(input)
  try {
    sendAgentMessage(input.db, {
      from: request.recipientAgentId,
      to: request.requesterAgentId,
      payload,
      origin: 'verification_result',
      attemptKind: 'verification_result',
      // Per attempt, not per request: a rerun's result is its own delivery, and reusing the request id
      // would collide with the first attempt's approval identity if the edge requires approval.
      attemptId: `${request.id}:${input.attempt.id}`,
    })
    return true
  } catch (error) {
    // A denied or held result message is not a verification failure, and the payload is never logged.
    console.warn(
      JSON.stringify({
        event: 'verification_result_not_delivered',
        requestId: request.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return false
  }
}

function renderResult(input: VerificationResultInput): string {
  const { request, attempt } = input
  const checks = listVerificationChecks(input.db, request.id)
  const outcomes = new Map(
    listVerificationCheckOutcomes(input.db, attempt.id).map((outcome) => [
      outcome.ordinal,
      outcome,
    ]),
  )
  const lines = [
    `Verification ${request.id}: ${input.outcome}.`,
    `Change: snapshot ${request.snapshotId} (base ${request.baseOid.slice(0, 12)}${
      request.snapshotComplete ? '' : ', INCOMPLETE COVERAGE'
    }).`,
    `Environment: image ${request.environment.image}, shell ${request.environment.sandbox}.`,
    input.applicability === null
      ? 'Applicability: not checked.'
      : `Applicability: ${input.applicability === 'identical' ? 'unchanged since capture' : input.applicability}.`,
    '',
    'Checks:',
  ]
  for (const check of checks) {
    const outcome = outcomes.get(check.ordinal)
    const state = outcome?.state ?? 'not_executed'
    const exit =
      outcome?.exitCode === null || outcome?.exitCode === undefined
        ? ''
        : ` exit ${outcome.exitCode}`
    // The reference is what grants a peer read access to that receipt — nothing else does.
    const receipt = outcome?.commandId
      ? ` coding-receipt:${outcome.commandId}`
      : outcome && ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(outcome.state)
        ? ' (receipt no longer available)'
        : ''
    lines.push(`  [${check.ordinal}] ${state}${exit} — ${check.command}${receipt}`)
  }
  const writes = attempt.observedWrites
  if (writes?.comparison === 'unknown') {
    lines.push(
      '',
      'Writes: could not be established (the tree could not be compared to the capture).',
    )
  } else if (writes) {
    if (writes.undeclaredPaths.length > 0) {
      lines.push(
        '',
        `Writes outside the declared output paths (${
          writes.declaredPaths.length === 0 ? 'none were declared' : writes.declaredPaths.join(', ')
        }): ${writes.undeclaredPaths.join(', ')}${writes.truncated ? ' …' : ''}`,
      )
    } else if (writes.observedPaths.length > 0) {
      lines.push('', `Writes: ${writes.observedPaths.join(', ')} — all inside the declared paths.`)
    }
  }
  if (attempt.error) lines.push('', `Limitation: ${attempt.error}`)
  // The same two facts the web panel shows, from one definition: a limit the operator can read on one
  // surface and not the other is a limit they will assume does not exist.
  lines.push('', VERIFICATION_OUTCOME_LIMITS[0], VERIFICATION_OUTCOME_LIMITS[1])
  const payload = lines.join('\n')
  return payload.length > MAX_RESULT_CHARACTERS
    ? `${payload.slice(0, MAX_RESULT_CHARACTERS)}\n[result truncated]`
    : payload
}
