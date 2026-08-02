import { createHash, randomUUID } from 'node:crypto'
import type {
  CommunicationApproval,
  CommunicationApprovalDetail,
  CommunicationApprovalEvent,
  CommunicationApprovalStatus,
  CommunicationAuthorizationResult,
  CommunicationEndpoint,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import type { AuthorizationInput } from '../team-policy/authorization.ts'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000

interface RawApproval {
  id: string
  attempt_kind: string
  attempt_id: string
  fingerprint: string
  operation: string
  source_kind: CommunicationEndpoint['kind']
  source_id: string
  target_kind: CommunicationEndpoint['kind']
  target_id: string
  source_team_id: string | null
  target_team_id: string | null
  channel: CommunicationApproval['channel']
  origin: string
  requester: string
  policy_refs_json: string
  required_edge_ids_json: string
  payload_kind: string
  payload_json: string
  status: CommunicationApprovalStatus
  expires_at: number
  decided_at: number | null
  decided_by: string | null
  decision_reason: string | null
  delivery_error: string | null
  created_at: number
  updated_at: number
}

interface RawEvent {
  id: string
  approval_id: string
  event: CommunicationApprovalEvent['event']
  actor: string
  detail: string | null
  created_at: number
}

function endpoint(kind: CommunicationEndpoint['kind'], id: string, teamId: string | null) {
  if (kind === 'agent') return { kind, id } as const
  return { kind, teamId: teamId ?? '__missing__' } as const
}

function toApproval(row: RawApproval): CommunicationApproval {
  return {
    id: row.id,
    attemptKind: row.attempt_kind,
    attemptId: row.attempt_id,
    operation: row.operation,
    source: endpoint(row.source_kind, row.source_id, row.source_team_id),
    target: endpoint(row.target_kind, row.target_id, row.target_team_id),
    sourceTeamId: row.source_team_id,
    targetTeamId: row.target_team_id,
    channel: row.channel,
    origin: row.origin,
    requester: row.requester,
    policyRefs: JSON.parse(row.policy_refs_json),
    requiredEdgeIds: JSON.parse(row.required_edge_ids_json),
    payloadKind: row.payload_kind,
    status: row.status,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    deliveryError: row.delivery_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function event(row: RawEvent): CommunicationApprovalEvent {
  return {
    id: row.id,
    approvalId: row.approval_id,
    event: row.event,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at,
  }
}

function raw(db: BazilionDb, id: string): RawApproval | null {
  return db.raw
    .query<RawApproval, [string]>('SELECT * FROM communication_approvals WHERE id = ?')
    .get(id)
}

function rawByAttempt(db: BazilionDb, kind: string, id: string): RawApproval | null {
  return db.raw
    .query<RawApproval, [string, string]>(
      'SELECT * FROM communication_approvals WHERE attempt_kind = ? AND attempt_id = ?',
    )
    .get(kind, id)
}

function appendEvent(
  db: BazilionDb,
  approvalId: string,
  name: CommunicationApprovalEvent['event'],
  actor: string,
  detail: string | null = null,
  now = Date.now(),
): void {
  db.raw.run(
    `INSERT INTO communication_approval_events
       (id, approval_id, event, actor, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), approvalId, name, actor, detail, now],
  )
}

function teams(db: BazilionDb, input: AuthorizationInput): [string | null, string | null] {
  const team = (value: CommunicationEndpoint): string | null =>
    value.kind === 'agent'
      ? (db.raw
          .query<{ team_id: string }, [string]>('SELECT team_id FROM agents WHERE id = ?')
          .get(value.id)?.team_id ?? null)
      : value.teamId
  const source = team(input.source) ?? team(input.target)
  const target = team(input.target) ?? team(input.source)
  return [source, target]
}

function fingerprint(
  input: AuthorizationInput,
  operation: string,
  payloadKind: string,
  payload: unknown,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ input, operation, payloadKind, payload }))
    .digest('hex')
}

export function request(
  db: BazilionDb,
  input: AuthorizationInput,
  operation: string,
  authorization: CommunicationAuthorizationResult,
  payloadKind: string,
  payload: unknown,
  options: { requester?: string; ttlMs?: number; now?: number } = {},
): CommunicationApproval {
  if (authorization.decision !== 'approval_required')
    throw new Error('approval_request_invalid: authorization does not require approval')
  const now = options.now ?? Date.now()
  const digest = fingerprint(input, operation, payloadKind, payload)
  try {
    return db.raw.transaction(() => {
      const existing = rawByAttempt(db, input.attemptKind, input.attemptId)
      if (existing) {
        if (existing.fingerprint !== digest)
          throw new Error('approval_attempt_conflict: attempt identity has different semantics')
        expireOne(db, existing, now)
        return toApproval(raw(db, existing.id) as RawApproval)
      }
      const id = randomUUID()
      const [sourceGroup, targetGroup] = teams(db, input)
      const expiresAt = now + (options.ttlMs ?? DEFAULT_TTL_MS)
      db.raw.run(
        `INSERT INTO communication_approvals
         (id, attempt_kind, attempt_id, fingerprint, operation, source_kind, source_id,
          target_kind, target_id, source_team_id, target_team_id, channel, origin,
          requester, policy_refs_json, required_edge_ids_json, payload_kind, payload_json,
          status, expires_at, decided_at, decided_by, decision_reason, delivery_error,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?,
               NULL, NULL, NULL, NULL, ?, ?)`,
        [
          id,
          input.attemptKind,
          input.attemptId,
          digest,
          operation,
          input.source.kind,
          input.source.kind === 'agent' ? input.source.id : '',
          input.target.kind,
          input.target.kind === 'agent' ? input.target.id : '',
          sourceGroup,
          targetGroup,
          authorization.channel,
          input.origin,
          options.requester ?? input.origin,
          JSON.stringify(authorization.policyRefs),
          JSON.stringify(authorization.requiredEdgeIds),
          payloadKind,
          JSON.stringify(payload),
          expiresAt,
          now,
          now,
        ],
      )
      appendEvent(db, id, 'requested', options.requester ?? input.origin, null, now)
      return toApproval(raw(db, id) as RawApproval)
    })()
  } catch (error) {
    const raced = rawByAttempt(db, input.attemptKind, input.attemptId)
    if (!raced) throw error
    if (raced.fingerprint !== digest)
      throw new Error('approval_attempt_conflict: attempt identity has different semantics')
    return toApproval(raced)
  }
}

function expireOne(db: BazilionDb, row: RawApproval, now: number): boolean {
  if (row.status !== 'pending' || row.expires_at > now) return false
  const changed = db.raw.run(
    `UPDATE communication_approvals
     SET status = 'expired', decided_at = ?, decided_by = 'system',
         decision_reason = 'approval expired', updated_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at <= ?`,
    [now, now, row.id, now],
  ).changes
  if (changed) appendEvent(db, row.id, 'expired', 'system', 'approval expired', now)
  return changed > 0
}

export function expirePending(db: BazilionDb, now = Date.now()): number {
  return db.raw.transaction(() => {
    const rows = db.raw
      .query<RawApproval, [number]>(
        "SELECT * FROM communication_approvals WHERE status = 'pending' AND expires_at <= ?",
      )
      .all(now)
    for (const row of rows) expireOne(db, row, now)
    return rows.length
  })()
}

export function get(
  db: BazilionDb,
  id: string,
  includePayload = false,
): CommunicationApprovalDetail | CommunicationApproval | null {
  expirePending(db)
  const row = raw(db, id)
  if (!row) return null
  const approval = toApproval(row)
  if (!includePayload) return approval
  return detailFromRow(db, row)
}

export function getByAttempt(
  db: BazilionDb,
  attemptKind: string,
  attemptId: string,
  includePayload = false,
): CommunicationApprovalDetail | CommunicationApproval | null {
  expirePending(db)
  const row = rawByAttempt(db, attemptKind, attemptId)
  if (!row) return null
  return includePayload ? detailFromRow(db, row) : toApproval(row)
}

function detailFromRow(db: BazilionDb, row: RawApproval): CommunicationApprovalDetail {
  const events = db.raw
    .query<RawEvent, [string]>(
      'SELECT * FROM communication_approval_events WHERE approval_id = ? ORDER BY created_at, rowid',
    )
    .all(row.id)
    .map(event)
  return { ...toApproval(row), payload: JSON.parse(row.payload_json), events }
}

export function list(
  db: BazilionDb,
  filters: { status?: CommunicationApprovalStatus; teamId?: string; limit?: number } = {},
): CommunicationApproval[] {
  expirePending(db)
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100)
  return db.raw
    .query<RawApproval, [string, string, string, string, string, number]>(
      `SELECT * FROM communication_approvals
       WHERE (? = '' OR status = ?)
         AND (? = '' OR source_team_id = ? OR target_team_id = ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(
      filters.status ?? '',
      filters.status ?? '',
      filters.teamId ?? '',
      filters.teamId ?? '',
      filters.teamId ?? '',
      limit,
    )
    .map(toApproval)
}

export function decide(
  db: BazilionDb,
  id: string,
  decision: 'deny' | 'cancel',
  actor: string,
  reason?: string,
  now = Date.now(),
): CommunicationApproval {
  expirePending(db, now)
  return db.raw.transaction(() => {
    const row = raw(db, id)
    if (!row) throw new Error(`approval_not_found: ${id}`)
    const current = raw(db, id) as RawApproval
    if (current.status !== 'pending')
      throw new Error(`approval_state_conflict: current ${current.status}`)
    const status = decision === 'deny' ? 'denied' : 'cancelled'
    const changed = db.raw.run(
      `UPDATE communication_approvals
       SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      [status, now, actor, reason ?? null, now, id],
    ).changes
    if (changed !== 1) throw new Error('approval_state_conflict: concurrent decision')
    appendEvent(db, id, decision === 'deny' ? 'denied' : 'cancelled', actor, reason ?? null, now)
    return toApproval(raw(db, id) as RawApproval)
  })()
}

export function claimDelivery(
  db: BazilionDb,
  id: string,
  actor: string,
  revalidate: (row: CommunicationApprovalDetail) => CommunicationAuthorizationResult,
  now = Date.now(),
): CommunicationApprovalDetail {
  expirePending(db, now)
  const outcome = db.raw.transaction(
    (): { detail?: CommunicationApprovalDetail; revalidationFailed?: true } => {
      const rawCurrent = raw(db, id)
      if (!rawCurrent) throw new Error(`approval_not_found: ${id}`)
      const detail = detailFromRow(db, raw(db, id) as RawApproval)
      if (detail.status !== 'pending')
        throw new Error(`approval_state_conflict: current ${detail.status}`)
      const authorization = revalidate(detail)
      const refsMatch =
        JSON.stringify(authorization.policyRefs) === JSON.stringify(detail.policyRefs) &&
        JSON.stringify(authorization.requiredEdgeIds) === JSON.stringify(detail.requiredEdgeIds)
      if (authorization.decision !== 'approval_required' || !refsMatch) {
        db.raw.run(
          `UPDATE communication_approvals
         SET status = 'denied', decided_at = ?, decided_by = ?, decision_reason = ?,
             updated_at = ? WHERE id = ? AND status = 'pending'`,
          [now, actor, 'policy or membership changed', now, id],
        )
        appendEvent(db, id, 'denied', actor, 'policy or membership changed', now)
        return { revalidationFailed: true }
      }
      const changed = db.raw.run(
        `UPDATE communication_approvals
       SET status = 'delivering', decided_at = ?, decided_by = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
        [now, actor, now, id],
      ).changes
      if (changed !== 1) throw new Error('approval_state_conflict: concurrent approval')
      appendEvent(db, id, 'approved', actor, null, now)
      appendEvent(db, id, 'delivery_started', actor, null, now)
      return {
        detail: {
          ...detail,
          status: 'delivering' as const,
          decidedAt: now,
          decidedBy: actor,
        },
      }
    },
  )()
  if (outcome.revalidationFailed)
    throw new Error('approval_revalidation_failed: policy or membership changed')
  if (!outcome.detail) throw new Error('approval_state_conflict: delivery claim failed')
  return outcome.detail
}

export interface SchedulerApprovalGrantResult {
  approval: CommunicationApproval
  granted: boolean
  failureKind?: 'revalidation' | 'delivery'
  error?: string
}

/**
 * Convert a scheduler approval into a durable grant without executing the
 * Agent turn in the HTTP request. The scheduler remains the only owner of
 * dispatch leases, retries, restart recovery, and final execution status.
 */
export function grantSchedulerTrigger(
  db: BazilionDb,
  id: string,
  actor: string,
  revalidate: (row: CommunicationApprovalDetail) => CommunicationAuthorizationResult,
  validateDelivery: (row: CommunicationApprovalDetail) => string | null,
  now = Date.now(),
): SchedulerApprovalGrantResult {
  expirePending(db, now)
  return db.raw.transaction(() => {
    const current = raw(db, id)
    if (!current) throw new Error(`approval_not_found: ${id}`)
    const detail = detailFromRow(db, current)
    if (detail.status !== 'pending')
      throw new Error(`approval_state_conflict: current ${detail.status}`)
    if (detail.operation !== 'scheduler_trigger' || detail.payloadKind !== 'scheduler_trigger') {
      throw new Error('approval_payload_conflict: not a scheduler trigger approval')
    }

    const authorization = revalidate(detail)
    const refsMatch =
      JSON.stringify(authorization.policyRefs) === JSON.stringify(detail.policyRefs) &&
      JSON.stringify(authorization.requiredEdgeIds) === JSON.stringify(detail.requiredEdgeIds)
    if (authorization.decision !== 'approval_required' || !refsMatch) {
      const error = 'policy or membership changed'
      const changed = db.raw.run(
        `UPDATE communication_approvals
         SET status = 'denied', decided_at = ?, decided_by = ?, decision_reason = ?,
             updated_at = ? WHERE id = ? AND status = 'pending'`,
        [now, actor, error, now, id],
      ).changes
      if (changed !== 1) throw new Error('approval_state_conflict: concurrent approval')
      appendEvent(db, id, 'denied', actor, error, now)
      return {
        approval: toApproval(raw(db, id) as RawApproval),
        granted: false,
        failureKind: 'revalidation' as const,
        error,
      }
    }

    let deliveryError: string | null = null
    try {
      deliveryError = validateDelivery(detail)
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : String(error)
    }
    if (deliveryError) {
      const changed = db.raw.run(
        `UPDATE communication_approvals
         SET status = 'delivery_failed', decided_at = ?, decided_by = ?,
             delivery_error = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [now, actor, deliveryError, now, id],
      ).changes
      if (changed !== 1) throw new Error('approval_state_conflict: concurrent approval')
      appendEvent(db, id, 'approved', actor, null, now)
      appendEvent(db, id, 'delivery_started', actor, null, now)
      appendEvent(db, id, 'delivery_failed', actor, deliveryError, now)
      return {
        approval: toApproval(raw(db, id) as RawApproval),
        granted: false,
        failureKind: 'delivery' as const,
        error: deliveryError,
      }
    }

    const changed = db.raw.run(
      `UPDATE communication_approvals
       SET status = 'delivered', decided_at = ?, decided_by = ?, delivery_error = NULL,
           updated_at = ? WHERE id = ? AND status = 'pending'`,
      [now, actor, now, id],
    ).changes
    if (changed !== 1) throw new Error('approval_state_conflict: concurrent approval')
    appendEvent(db, id, 'approved', actor, null, now)
    appendEvent(db, id, 'delivery_started', actor, null, now)
    appendEvent(db, id, 'delivered', actor, null, now)
    return { approval: toApproval(raw(db, id) as RawApproval), granted: true }
  })()
}

export function finishDelivery(
  db: BazilionDb,
  id: string,
  ok: boolean,
  actor: string,
  error?: string,
  now = Date.now(),
): CommunicationApproval {
  return db.raw.transaction(() => {
    const status = ok ? 'delivered' : 'delivery_failed'
    const changed = db.raw.run(
      `UPDATE communication_approvals
       SET status = ?, delivery_error = ?, updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
      [status, ok ? null : (error ?? 'delivery failed'), now, id],
    ).changes
    if (changed !== 1) throw new Error('approval_state_conflict: delivery is not claimable')
    appendEvent(
      db,
      id,
      ok ? 'delivered' : 'delivery_failed',
      actor,
      ok ? null : (error ?? 'delivery failed'),
      now,
    )
    return toApproval(raw(db, id) as RawApproval)
  })()
}
