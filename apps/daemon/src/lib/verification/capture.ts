import type {
  VerificationBlocker,
  VerificationEnvironmentFacts,
  VerificationReport,
  VerificationRequest as VerificationRequestWire,
  VerificationSummary,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import {
  createVerificationRequest,
  getVerificationRequest,
  listVerificationAttempts,
  listVerificationCheckOutcomes,
  listVerificationChecks,
  type VerificationRequestRecord,
} from '../../core/repos/verification-requests.ts'
import { resolveShellSecurityConfig } from '../../runtime/shell/security.ts'
import { resolveTeamCodingEnvironment } from '../coding-environment/resolve.ts'
import { readSnapshotApplicability, requireTeam } from '../git-review/service.ts'
import {
  type VerificationCaptureIntent,
  validateVerificationCaptureInputs,
} from './capture-input.ts'
import {
  consumeNativeVerificationCapture,
  type NativeVerificationCapture,
  prepareNativeOperatorVerificationCapture,
} from './native-capture.ts'
import { NativeVerificationPreparationError } from './native-error.ts'

export type { VerificationCaptureIntent } from './capture-input.ts'
export type VerificationCaptureResult =
  | { kind: 'captured'; request: VerificationRequestRecord }
  | { kind: 'blocked'; blocker: VerificationBlocker }

/** Actual inputs are validated; only a nominal readiness observation can supply native facts. */
export function captureVerificationRequest(
  db: BazilionDb,
  paths: Paths,
  intent: VerificationCaptureIntent,
  env: NodeJS.ProcessEnv = process.env,
  native?: NativeVerificationCapture,
): VerificationCaptureResult {
  const validation = validateVerificationCaptureInputs(db, paths, intent)
  if (validation.kind === 'blocked') return validation
  let environment: VerificationEnvironmentFacts | null
  try {
    environment =
      native === undefined
        ? admittedEnvironment(db, validation.teamId, env)
        : consumeNativeVerificationCapture(native, db, paths, intent)
  } catch {
    return blocked(
      'environment_unavailable',
      'the native capture observation is unavailable or does not match this request',
    )
  }
  if (!environment)
    return blocked(
      'environment_unavailable',
      'the Team has no usable admitted environment to freeze with the request',
    )
  if (validation.writablePaths.length) environment.writablePaths = validation.writablePaths
  const snapshot = validation.snapshot
  try {
    const request = createVerificationRequest(db, {
      teamId: validation.teamId,
      requesterKind: intent.requesterKind,
      requesterAgentId: intent.requesterKind === 'agent' ? intent.requesterAgentId : null,
      recipientAgentId: validation.recipientAgentId,
      messageId: intent.messageId ?? null,
      sourceSessionId: intent.sourceSessionId ?? null,
      snapshotId: snapshot.snapshotId,
      snapshotComplete: snapshot.complete,
      head: snapshot.head,
      baseOid: snapshot.baseOid,
      environment,
      summary: intent.summary ?? null,
      checks: intent.checks,
    })
    return { kind: 'captured', request }
  } catch (error) {
    return blocked('unsupported', error instanceof Error ? error.message : 'invalid request')
  }
}

/** Native readiness/capture primitive; public callers use the tracked selected-capture boundary. */
export async function captureNativeOperatorVerificationRequest(
  db: BazilionDb,
  paths: Paths,
  intent: VerificationCaptureIntent,
  signal: AbortSignal | undefined,
  secrets: () => readonly string[],
  assertSelection?: () => void,
): Promise<VerificationCaptureResult> {
  try {
    const prepared = await prepareNativeOperatorVerificationCapture({
      db,
      paths,
      intent,
      signal,
      secrets,
      assertSelection,
    })
    if (prepared.kind === 'blocked') return prepared
    return captureVerificationRequest(db, paths, prepared.intent, undefined, prepared.capture)
  } catch (error) {
    return blocked(
      'environment_unavailable',
      error instanceof NativeVerificationPreparationError && !error.cleanupConfirmed
        ? 'Native readiness cleanup is unconfirmed; workspace recovery is required.'
        : 'The Team has no usable native environment to freeze with the request.',
    )
  }
}

/** Legacy passive selection. Native facts never come from configuration or an image label. */
export function admittedEnvironment(
  db: BazilionDb,
  teamId: string,
  env: NodeJS.ProcessEnv,
): VerificationEnvironmentFacts | null {
  try {
    const security = resolveShellSecurityConfig(env)
    if (security.sandboxMode === 'native') return null
    const resolved = resolveTeamCodingEnvironment(db, teamId, env)
    if (!resolved.image) return null
    return {
      image: resolved.image,
      sandbox: security.sandboxMode === 'docker' ? 'docker' : 'off',
      ...(resolved.coding ? { cwd: resolved.coding.cwd, env: { ...resolved.coding.env } } : {}),
    }
  } catch {
    return null
  }
}

/** Shared report composition: one immutable contract and the outcomes of every attempt. */
export function readVerificationSummary(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  requestId: string,
): VerificationSummary | null {
  const team = safeTeam(db, paths, teamId)
  if (!team) return null
  const record = getVerificationRequest(db, team.id, requestId)
  if (!record) return null
  const checks = listVerificationChecks(db, record.id)
  const attempts = listVerificationAttempts(db, record.id).map((attempt) => ({
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    supersedesAttemptId: attempt.supersedesAttemptId,
    state: attempt.state,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    error: attempt.error,
    observedWrites: attempt.observedWrites,
    outcomes: listVerificationCheckOutcomes(db, attempt.id).map((outcome) => ({
      ordinal: outcome.ordinal,
      state: outcome.state,
      commandId: outcome.commandId,
      // Known execution can outlive its pruned receipt; unknown alone cannot prove execution.
      receiptUnavailable:
        outcome.commandId === null &&
        ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(outcome.state),
      exitCode: outcome.exitCode,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
    })),
  }))
  return {
    request: toWireRequest(record),
    checks: checks.map((check) => ({
      ordinal: check.ordinal,
      command: check.command,
      cwd: check.cwd,
      purpose: check.purpose,
      timeoutMs: check.timeoutMs,
    })),
    attempts,
  }
}

/** Three-valued applicability is a comparison, never a pass or relevance claim. */
export async function readVerificationReport(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  requestId: string,
): Promise<VerificationReport | null> {
  const summary = readVerificationSummary(db, paths, teamId, requestId)
  if (!summary) return null
  const applicability = await readSnapshotApplicability(
    db,
    paths,
    summary.request.teamId,
    summary.request.snapshot.id,
  )
  return {
    ...summary,
    applicability: {
      comparison: applicability.comparison,
      testedSnapshotId: applicability.comparison === 'unknown' ? null : summary.request.snapshot.id,
    },
  }
}

export function toWireRequest(record: VerificationRequestRecord): VerificationRequestWire {
  return {
    id: record.id,
    teamId: record.teamId,
    requester:
      record.requesterKind === 'agent' && record.requesterAgentId
        ? { kind: 'agent', agentId: record.requesterAgentId }
        : { kind: 'operator' },
    recipientAgentId: record.recipientAgentId,
    messageId: record.messageId,
    sourceSessionId: record.sourceSessionId,
    snapshot: {
      id: record.snapshotId,
      complete: record.snapshotComplete,
      head: record.head,
      baseOid: record.baseOid,
    },
    environment: record.environment,
    summary: record.summary,
    state: record.state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }
}
function blocked(reason: VerificationBlocker['reason'], detail: string): VerificationCaptureResult {
  return { kind: 'blocked', blocker: { reason, detail } }
}
function safeTeam(db: BazilionDb, paths: Paths, teamId: string) {
  try {
    return requireTeam(db, paths, teamId)
  } catch {
    return null
  }
}
