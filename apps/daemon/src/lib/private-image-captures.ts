import type {
  CommunicationApprovalStatus,
  PrivateImageCapture,
  PrivateImageCaptureListResponse,
  PrivateImageDiscardResponse,
  PrivateImageRecoveryResponse,
} from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import { expirePending } from '../core/repos/communicationApprovals.ts'
import { COMPLETED_IMAGE_CAPTURE_SQL } from '../core/repos/image-generations.ts'
import { isActiveAgent } from './agent-cancel.ts'
import { authorizeCapturedLibraryResult } from './result-library-delivery.ts'
import { RESULT_APPROVAL_REFERENCE_SQL } from './result-retention.ts'

const projection = `r.id, r.team_id AS teamId, r.agent_id AS agentId,
  r.created_at AS createdAt, r.byte_length AS byteLength`

export class PrivateImageCaptureError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

export function assertImageScope(db: BazilionDb, teamId: unknown): asserts teamId is string {
  if (typeof teamId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(teamId))
    throw new PrivateImageCaptureError('A valid original teamId is required', 400)
  if (!db.raw.query<{ id: string }, [string]>('SELECT id FROM teams WHERE id = ?').get(teamId))
    throw new PrivateImageCaptureError('Team not found', 404)
}

export function listPrivateImageCaptures(
  db: BazilionDb,
  scope: { teamId: string; agentId?: string; limit: number; offset: number },
): PrivateImageCaptureListResponse {
  assertImageScope(db, scope.teamId)
  const where = `r.team_id = ? AND r.deleted_at IS NULL AND r.released_at IS NULL
    AND (${COMPLETED_IMAGE_CAPTURE_SQL})${scope.agentId ? ' AND r.agent_id = ?' : ''}`
  const params = [scope.teamId, ...(scope.agentId ? [scope.agentId] : [])]
  const totals = db.raw
    .query<{ total: number; privateBytes: number }, string[]>(
      `SELECT count(*) AS total, coalesce(sum(r.byte_length), 0) AS privateBytes
     FROM agent_results r WHERE ${where}`,
    )
    .get(...params)
  const captures = db.raw
    .query<PrivateImageCapture, (string | number)[]>(
      `SELECT ${projection} FROM agent_results r WHERE ${where}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, scope.limit, scope.offset)
  const retainedBytes =
    db.raw
      .query<{ n: number }, []>(
        'SELECT coalesce(sum(byte_length), 0) AS n FROM agent_results WHERE deleted_at IS NULL',
      )
      .get()?.n ?? 0
  return {
    captures,
    total: totals?.total ?? 0,
    privateBytes: totals?.privateBytes ?? 0,
    retainedBytes,
    limit: scope.limit,
    offset: scope.offset,
  }
}

function capture(db: BazilionDb, teamId: string, id: string) {
  assertImageScope(db, teamId)
  const row = db.raw
    .query<PrivateImageCapture & { releasedAt: number | null }, [string, string]>(
      `SELECT ${projection}, r.released_at AS releasedAt FROM agent_results r
     WHERE r.id = ? AND r.team_id = ? AND r.deleted_at IS NULL
       AND (${COMPLETED_IMAGE_CAPTURE_SQL})`,
    )
    .get(id, teamId)
  if (!row) throw new PrivateImageCaptureError('Private image capture not found', 404)
  return row
}

function heldDelivery(db: BazilionDb, id: string, liveOnly = false) {
  expirePending(db)
  return db.raw
    .query<
      {
        id: string
        status: CommunicationApprovalStatus
        attempt_kind: string
        attempt_id: string
      },
      [string]
    >(
      `SELECT id, status, attempt_kind, attempt_id FROM communication_approvals
     WHERE (${RESULT_APPROVAL_REFERENCE_SQL}) = ?
     ${liveOnly ? "AND status IN ('pending', 'approved', 'delivering')" : ''}
     ORDER BY CASE WHEN status IN ('approved', 'delivering') THEN 0
       WHEN status = 'pending' THEN 1 ELSE 2 END, created_at, id LIMIT 1`,
    )
    .get(id)
}

/** Explicit operator intent, not a worker capability or a transport/generation retry. */
export function recoverPrivateImage(
  db: BazilionDb,
  teamId: string,
  id: string,
): PrivateImageRecoveryResponse {
  return db.raw.transaction((): PrivateImageRecoveryResponse => {
    const row = capture(db, teamId, id)
    if (row.releasedAt !== null) return { resultId: id, status: 'already_released' }
    if (isActiveAgent(row.agentId))
      return { resultId: id, status: 'blocked', reason: 'producer_active' }
    const producer = db.raw
      .query<{ team_id: string; status: string }, [string]>(
        'SELECT team_id, status FROM agents WHERE id = ?',
      )
      .get(row.agentId)
    if (!producer || producer.team_id !== row.teamId || producer.status === 'archived')
      return { resultId: id, status: 'blocked', reason: 'producer_unavailable' }
    const hold = heldDelivery(db, id)
    if (hold) {
      if (
        hold.status === 'pending' &&
        hold.attempt_kind === 'result_publication' &&
        hold.attempt_id === id
      )
        return { resultId: id, status: 'approval_required', approvalId: hold.id }
      return {
        resultId: id,
        status: 'blocked',
        reason: ['pending', 'approved', 'delivering'].includes(hold.status)
          ? 'delivery_pending'
          : 'delivery_closed',
        approvalStatus: hold.status,
      }
    }
    const result = authorizeCapturedLibraryResult(db, row.agentId, id)
    if (result.status === 'released') return { resultId: id, status: 'released' }
    if (result.status === 'denied')
      return { resultId: id, status: 'blocked', reason: 'policy_denied' }
    if (result.approval.status !== 'pending')
      return {
        resultId: id,
        status: 'blocked',
        reason: 'delivery_closed',
        approvalStatus: result.approval.status,
      }
    return { resultId: id, status: 'approval_required', approvalId: result.approval.id }
  })()
}

/** Owner-confirmed deletion is not disclosure; unavailable producers may still be discarded. */
export function discardPrivateImage(
  db: BazilionDb,
  teamId: string,
  id: string,
): PrivateImageDiscardResponse {
  return db.raw.transaction((): PrivateImageDiscardResponse => {
    const row = capture(db, teamId, id)
    if (row.releasedAt !== null)
      throw new PrivateImageCaptureError('Use normal saved-result deletion for released files', 409)
    if (isActiveAgent(row.agentId) || heldDelivery(db, id, true))
      throw new PrivateImageCaptureError(
        'Producer or delivery is active; settle it before discarding',
        409,
      )
    const changed = db.raw.run(
      'UPDATE agent_results SET bytes = NULL, deleted_at = ? WHERE id = ? AND released_at IS NULL AND deleted_at IS NULL',
      [Date.now(), id],
    ).changes
    if (changed !== 1) throw new PrivateImageCaptureError('Capture changed before discard', 409)
    return { resultId: id, discarded: true }
  })()
}
