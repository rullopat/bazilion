import type {
  VerificationBlocker,
  VerificationCheckInput,
  VerificationEnvironmentFacts,
  VerificationReport,
  VerificationRequest as VerificationRequestWire,
} from '@bazilion/api-types'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getSourceSnapshot } from '../../core/repos/source-snapshots.ts'
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

// BAZ-044: capture one verification request from an Agent or the operator.
//
// Capture validates the *actual* inputs rather than the caller's description of them: the snapshot
// must exist in this Team inside its window, the specialist must be a live member of the same Team,
// and the environment is the one the Team is admitted into right now. Anything unavailable is
// reported as a blocker — never substituted, and never captured as a request that will fail later.

export type VerificationCaptureIntent = {
  teamId: string
  recipientAgentId: string
  snapshotId: string
  checks: readonly VerificationCheckInput[]
  summary?: string | null
  sourceSessionId?: string | null
  messageId?: string | null
  /** Declared, bounded locations a check may write generated output to. */
  writablePaths?: string[]
} & (
  | { requesterKind: 'agent'; requesterAgentId: string }
  | { requesterKind: 'operator'; requesterAgentId?: null }
)

export type VerificationCaptureResult =
  | { kind: 'captured'; request: VerificationRequestRecord }
  | { kind: 'blocked'; blocker: VerificationBlocker }

/** Capture a request, or explain precisely why it cannot be executed. */
export function captureVerificationRequest(
  db: BazilionDb,
  paths: Paths,
  intent: VerificationCaptureIntent,
  env: NodeJS.ProcessEnv = process.env,
): VerificationCaptureResult {
  const team = safeTeam(db, paths, intent.teamId)
  if (!team) return blocked('unsupported', 'the request does not name a known Team')

  const recipient = getAgent(db, intent.recipientAgentId)
  if (!recipient) return blocked('recipient_unavailable', 'the selected specialist does not exist')
  if (recipient.teamId !== team.id) {
    // Sharing a backend is not sharing a Team: cross-Team handoff is out of scope for this story.
    return blocked('recipient_not_same_team', 'the selected specialist belongs to another Team')
  }
  if (recipient.status === 'archived') {
    return blocked('recipient_unavailable', 'the selected specialist is archived')
  }

  if (intent.requesterKind === 'agent') {
    const requester = getAgent(db, intent.requesterAgentId)
    if (!requester) return blocked('requester_unavailable', 'the requesting Agent does not exist')
    if (requester.teamId !== team.id) {
      return blocked('requester_unavailable', 'the requesting Agent belongs to another Team')
    }
    if (requester.id === recipient.id) {
      return blocked('unsupported', 'a specialist cannot verify its own request')
    }
  }

  const snapshot = getSourceSnapshot(db, team.id, intent.snapshotId)
  if (!snapshot) {
    return blocked(
      'snapshot_unavailable',
      'the captured change is unknown in this Team or past its retention window',
    )
  }
  if (!snapshot.complete) {
    return blocked(
      'snapshot_incomplete',
      'the captured change has incomplete coverage, so a result could not be tied to it',
    )
  }

  const environment = admittedEnvironment(db, team.id, env)
  if (!environment) {
    return blocked(
      'environment_unavailable',
      'the Team has no usable admitted environment to freeze with the request',
    )
  }
  if (intent.writablePaths && intent.writablePaths.length > 0) {
    const bounded = intent.writablePaths.filter((path) => path.length > 0 && path.length <= 1_000)
    if (bounded.length !== intent.writablePaths.length || bounded.length > 16) {
      return blocked('unsupported', 'declared writable paths are outside their bounded contract')
    }
    environment.writablePaths = bounded
  }

  try {
    const request = createVerificationRequest(db, {
      teamId: team.id,
      requesterKind: intent.requesterKind,
      requesterAgentId: intent.requesterKind === 'agent' ? intent.requesterAgentId : null,
      recipientAgentId: recipient.id,
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
    // A rejected request is a blocker with the reason the store gave, not a silent retry.
    return blocked('unsupported', error instanceof Error ? error.message : 'invalid request')
  }
}

/**
 * The environment the request is frozen against.
 *
 * Passive selection only: nothing here runs Docker, a version command or project code, so capturing
 * a request never has side effects on the repository.
 */
export function admittedEnvironment(
  db: BazilionDb,
  teamId: string,
  env: NodeJS.ProcessEnv,
): VerificationEnvironmentFacts | null {
  try {
    const security = resolveShellSecurityConfig(env)
    const resolved = resolveTeamCodingEnvironment(db, teamId, env)
    if (!resolved.image) return null
    return {
      image: resolved.image,
      sandbox: security.sandboxMode === 'docker' ? 'docker' : 'off',
      ...(resolved.coding ? { cwd: resolved.coding.cwd } : {}),
      ...(resolved.coding ? { env: { ...resolved.coding.env } } : {}),
    }
  } catch {
    // An unusable stored environment is a blocker, not a reason to invent a default.
    return null
  }
}

/** Compose the operator view of one request: its contract, its attempts, and current applicability. */
export async function readVerificationReport(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  requestId: string,
): Promise<VerificationReport | null> {
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
    outcomes: listVerificationCheckOutcomes(db, attempt.id).map((outcome) => ({
      ordinal: outcome.ordinal,
      state: outcome.state,
      commandId: outcome.commandId,
      exitCode: outcome.exitCode,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
    })),
  }))
  // Applicability is three-valued and never a pass: a comparison shows that the source changed,
  // not that the change was relevant. A capture with no comparison reads as unknown.
  const applicability = await readSnapshotApplicability(db, paths, team.id, record.snapshotId)
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
    applicability: {
      comparison: applicability.comparison,
      testedSnapshotId: applicability.comparison === 'unknown' ? null : record.snapshotId,
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
