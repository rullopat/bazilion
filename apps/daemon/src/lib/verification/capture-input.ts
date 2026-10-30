import type { VerificationBlocker, VerificationCheckInput } from '@bazilion/api-types'
import { codingRelativePath } from '../../core/coding-environment/config.ts'
import type { BazilionDb } from '../../core/db/client.ts'
import type { Paths } from '../../core/paths.ts'
import { get as getAgent } from '../../core/repos/agents.ts'
import { getSourceSnapshot, type SourceSnapshotRecord } from '../../core/repos/source-snapshots.ts'
import { validateVerificationChecks } from '../../core/repos/verification-requests.ts'
import { requireTeam } from '../git-review/service.ts'

export type VerificationCaptureIntent = {
  teamId: string
  recipientAgentId: string
  snapshotId: string
  checks: readonly VerificationCheckInput[]
  summary?: string | null
  sourceSessionId?: string | null
  messageId?: string | null
  writablePaths?: readonly string[]
} & (
  | { requesterKind: 'agent'; requesterAgentId: string }
  | { requesterKind: 'operator'; requesterAgentId?: null }
)
export type VerificationCaptureInputValidation =
  | {
      kind: 'valid'
      teamId: string
      recipientAgentId: string
      snapshot: SourceSnapshotRecord
      writablePaths: string[]
    }
  | { kind: 'blocked'; blocker: VerificationBlocker }
const blocked = (
  reason: VerificationBlocker['reason'],
  detail: string,
): VerificationCaptureInputValidation => ({ kind: 'blocked', blocker: { reason, detail } })

/** Pure validation before any backend preparation; reused again immediately before capture. */
export function validateVerificationCaptureInputs(
  db: BazilionDb,
  paths: Paths,
  intent: VerificationCaptureIntent,
): VerificationCaptureInputValidation {
  let team: ReturnType<typeof requireTeam>
  try {
    team = requireTeam(db, paths, intent.teamId)
  } catch {
    return blocked('unsupported', 'the request does not name a known Team')
  }
  const recipient = getAgent(db, intent.recipientAgentId)
  if (!recipient) return blocked('recipient_unavailable', 'the selected specialist does not exist')
  if (recipient.teamId !== team.id)
    return blocked('recipient_not_same_team', 'the selected specialist belongs to another Team')
  if (recipient.status === 'archived')
    return blocked('recipient_unavailable', 'the selected specialist is archived')
  if (intent.requesterKind === 'agent') {
    const requester = getAgent(db, intent.requesterAgentId)
    if (!requester) return blocked('requester_unavailable', 'the requesting Agent does not exist')
    if (requester.teamId !== team.id)
      return blocked('requester_unavailable', 'the requesting Agent belongs to another Team')
    if (requester.status === 'archived')
      return blocked('requester_unavailable', 'the requesting Agent is archived')
    if (requester.id === recipient.id)
      return blocked('unsupported', 'a specialist cannot verify its own request')
  }
  const snapshot = getSourceSnapshot(db, team.id, intent.snapshotId)
  if (!snapshot)
    return blocked(
      'snapshot_unavailable',
      'the captured change is unknown in this Team or past its retention window',
    )
  if (!snapshot.complete)
    return blocked(
      'snapshot_incomplete',
      'the captured change has incomplete coverage, so a result could not be tied to it',
    )
  const writablePaths: string[] = []
  for (const path of intent.writablePaths ?? []) {
    if (typeof path !== 'string' || path.length === 0 || path.length > 1000)
      return blocked('unsupported', 'declared writable paths are outside their bounded contract')
    if (path.startsWith('/') || path.startsWith('~') || path.includes('\\'))
      return blocked('unsupported', `declared writable path must be Team-relative: ${path}`)
    const parts = path.split('/').filter((part) => part && part !== '.')
    if (parts.length === 0 || parts.some((part) => part === '..'))
      return blocked('unsupported', `declared writable path must be inside the workspace: ${path}`)
    writablePaths.push(parts.join('/'))
  }
  if (writablePaths.length > 16) return blocked('unsupported', 'too many declared writable paths')
  try {
    validateVerificationChecks(intent.checks)
  } catch (error) {
    return blocked(
      'unsupported',
      error instanceof Error ? error.message : 'invalid captured checks',
    )
  }
  for (const check of intent.checks) {
    try {
      codingRelativePath(check.cwd)
    } catch {
      return blocked(
        'unsupported',
        `a check working directory must be a path inside the workspace: ${String(check.cwd)}`,
      )
    }
  }
  return { kind: 'valid', teamId: team.id, recipientAgentId: recipient.id, snapshot, writablePaths }
}

/** Reject before the request or specialist brief can project a known protected credential. */
export function assertVerificationCommandSecrets(
  intent: { checks: readonly { command: string }[] },
  secrets: readonly string[],
): void {
  if (
    secrets.some((value) => value && intent.checks.some((check) => check.command.includes(value)))
  )
    throw new Error('verification command contains protected credential material')
}

/** Known capture fields are copied before asynchronous readiness; callers cannot rewrite the job. */
export function snapshotVerificationCaptureIntent(
  intent: VerificationCaptureIntent,
): VerificationCaptureIntent {
  return Object.freeze({
    ...intent,
    checks: Object.freeze(intent.checks.map((check) => Object.freeze({ ...check }))),
    ...(intent.writablePaths ? { writablePaths: Object.freeze([...intent.writablePaths]) } : {}),
  })
}
