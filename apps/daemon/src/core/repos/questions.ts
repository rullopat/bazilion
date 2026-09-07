import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentQuestion,
  AgentQuestionInput,
  AgentQuestionNoAnswerReason,
  AgentQuestionResponseInput,
} from '@bazilion/api-types'
import {
  parseQuestionInput,
  parseQuestionResponse,
  QUESTION_LIMITS,
} from '../../lib/question-input.ts'
import type { BazilionDb } from '../db/client.ts'
import * as communicationApprovals from './communicationApprovals.ts'

const fields = `id, agent_id AS agentId, team_id AS teamId, conversation_id AS conversationId,
 turn_id AS turnId, tool_call_id AS toolCallId, question_json AS questionJson, status, revision,
 created_at AS createdAt, expires_at AS expiresAt, settled_at AS settledAt, delivered_at AS deliveredAt, answer_json AS answerJson,
 response_request_id AS responseRequestId, no_answer_reason AS noAnswerReason, continuation,
 consumed_at AS consumedAt, delivery_approval_id AS deliveryApprovalId, answer_approval_id AS answerApprovalId`
type Row = Omit<AgentQuestion, 'question' | 'answer'> & {
  questionJson: string
  answerJson: string | null
}
function decode(row: Row): AgentQuestion {
  const { questionJson, answerJson, ...item } = row
  return {
    ...item,
    question: parseQuestionInput(JSON.parse(questionJson)),
    answer: answerJson === null ? null : JSON.parse(answerJson),
  }
}
export function get(db: BazilionDb, agentId: string, id: string): AgentQuestion | null {
  const row = db.raw
    .query<Row, [string, string]>(
      `SELECT ${fields} FROM agent_questions WHERE agent_id = ? AND id = ?`,
    )
    .get(agentId, id)
  return row ? decode(row) : null
}
export function list(
  db: BazilionDb,
  agentId: string,
  limit = 20,
  conversationId?: string,
): AgentQuestion[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid question limit')
  return db.raw
    .query<Row, [string, string | null, string | null, number]>(
      `SELECT ${fields} FROM agent_questions WHERE agent_id = ? AND (? IS NULL OR conversation_id = ?) ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(agentId, conversationId ?? null, conversationId ?? null, limit)
    .map(decode)
}
function required(db: BazilionDb, agentId: string, id: string): AgentQuestion {
  const item = get(db, agentId, id)
  if (!item) throw new Error('Question unavailable')
  return item
}
export interface QuestionCreation {
  agentId: string
  teamId: string
  conversationId: string
  turnId: string
  toolCallId: string
  question: AgentQuestionInput
  /** Daemon-created response route and creator identity, never public request data. */
  binding: unknown
  deadline?: number
}
export function create(db: BazilionDb, input: QuestionCreation, now = Date.now()): AgentQuestion {
  const question = parseQuestionInput(input.question)
  if (
    !input.turnId ||
    !input.toolCallId ||
    input.turnId.length > 256 ||
    input.toolCallId.length > 256
  )
    throw new Error('Invalid question identity')
  const binding = JSON.stringify(input.binding)
  if (!binding || Buffer.byteLength(binding) > 16_384) throw new Error('Invalid question binding')
  const expiresAt = Math.min(now + QUESTION_LIMITS.waitMs, input.deadline ?? Infinity)
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now)
    throw new Error('Question deadline elapsed')
  return db.raw.transaction(() => {
    const agent = db.raw
      .query<{ team_id: string; status: string }, [string]>(
        'SELECT team_id, status FROM agents WHERE id = ?',
      )
      .get(input.agentId)
    if (!agent || agent.team_id !== input.teamId || agent.status === 'archived')
      throw new Error('Question Agent binding changed')
    const count = db.raw
      .query<{ total: number; pending: number; turn: number }, [string]>(`SELECT COUNT(*) AS total,
      COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(turn_id = ?), 0) AS turn FROM agent_questions`)
      .get(input.turnId)
    if (
      !count ||
      count.total >= QUESTION_LIMITS.recordsPerHome ||
      count.pending >= QUESTION_LIMITS.pendingPerHome ||
      count.turn >= QUESTION_LIMITS.perTurn
    )
      throw new Error('Question capacity reached')
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO agent_questions (id, agent_id, team_id, conversation_id, turn_id, tool_call_id,
      question_json, binding_json, status, created_at, expires_at, continuation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'waiting')`,
      [
        id,
        input.agentId,
        input.teamId,
        input.conversationId,
        input.turnId,
        input.toolCallId,
        JSON.stringify(question),
        binding,
        now,
        expiresAt,
      ],
    )
    return required(db, input.agentId, id)
  })()
}
export type QuestionSettlement = {
  kind: 'accepted' | 'already_applied' | 'conflict'
  question: AgentQuestion
}
/** Called only after the live host has authorized the exact reply. SQLite selects one winner. */
export function answer(
  db: BazilionDb,
  agentId: string,
  id: string,
  value: AgentQuestionResponseInput,
  now = Date.now(),
  approvalId?: string,
): QuestionSettlement {
  return db.raw.transaction((): QuestionSettlement => {
    const item = required(db, agentId, id)
    const input = parseQuestionResponse(value, item.question, item.conversationId)
    if (
      item.responseRequestId === input.requestId &&
      JSON.stringify(item.answer) === JSON.stringify(input.answer)
    )
      return { kind: 'already_applied', question: item }
    if (item.status !== 'pending') return { kind: 'conflict', question: item }
    if (item.expiresAt <= now)
      return { kind: 'conflict', question: close(db, agentId, id, 'expired', now) }
    if (!ownsApproval(db, item.answerApprovalId, approvalId))
      return { kind: 'conflict', question: item }
    const proposal = approvalSnapshot(db, agentId, id)?.proposal
    if (proposal && JSON.stringify(proposal) !== JSON.stringify(input))
      return { kind: 'conflict', question: item }
    db.raw.run(
      `UPDATE agent_questions SET status = ?, answer_json = ?, response_request_id = ?,
      no_answer_reason = ?, settled_at = ?, continuation = 'unconfirmed', revision = revision + 1 WHERE id = ? AND status = 'pending'`,
      [
        input.answer.kind === 'skip' ? 'skipped' : 'answered',
        JSON.stringify(input.answer),
        input.requestId,
        input.answer.kind === 'skip' ? 'skipped' : null,
        now,
        id,
      ],
    )
    return { kind: 'accepted', question: required(db, agentId, id) }
  })()
}
export function close(
  db: BazilionDb,
  agentId: string,
  id: string,
  reason: Exclude<AgentQuestionNoAnswerReason, 'skipped'>,
  now = Date.now(),
): AgentQuestion {
  return db.raw.transaction(() => {
    db.raw.run(
      `UPDATE agent_questions SET status = ?, no_answer_reason = ?, settled_at = ?,
    continuation = ?, revision = revision + 1 WHERE agent_id = ? AND id = ? AND status = 'pending'`,
      [
        reason === 'expired' ? 'expired' : 'cancelled',
        reason,
        now,
        reason === 'expired' ? 'unconfirmed' : 'interrupted',
        agentId,
        id,
      ],
    )
    retireClosedApprovals(db, now)
    return required(db, agentId, id)
  })()
}
/** Evidence has to be verified by the live IPC host against canonical Pi history first. */
export function markConsumed(
  db: BazilionDb,
  agentId: string,
  id: string,
  turnId: string,
  toolCallId: string,
  now = Date.now(),
): AgentQuestion {
  db.raw.run(
    `UPDATE agent_questions SET continuation = 'consumed', consumed_at = ?, revision = revision + 1
    WHERE agent_id = ? AND id = ? AND turn_id = ? AND tool_call_id = ? AND continuation = 'unconfirmed'
    AND status IN ('answered','skipped','expired')`,
    [now, agentId, id, turnId, toolCallId],
  )
  return required(db, agentId, id)
}
export function closeTurn(
  db: BazilionDb,
  turnId: string,
  reason: 'cancelled' | 'worker_lost',
  now = Date.now(),
): void {
  db.raw.transaction(() => {
    db.raw.run(
      `UPDATE agent_questions SET status = 'cancelled', no_answer_reason = ?, settled_at = ?,
      continuation = 'interrupted', revision = revision + 1 WHERE turn_id = ? AND status = 'pending'`,
      [reason, now, turnId],
    )
    db.raw.run(
      `UPDATE agent_questions SET continuation = 'interrupted', revision = revision + 1
      WHERE turn_id = ? AND continuation = 'unconfirmed'`,
      [turnId],
    )
    retireClosedApprovals(db, now)
  })()
}
export function recoverInterrupted(
  db: BazilionDb,
  reason: 'daemon_restart' | 'restored_backup' = 'daemon_restart',
  now = Date.now(),
): void {
  db.raw.transaction(() => {
    db.raw.run(
      `UPDATE agent_questions SET status = 'cancelled', no_answer_reason = ?, settled_at = ?,
      continuation = 'interrupted', revision = revision + 1 WHERE status = 'pending'`,
      [reason, now],
    )
    db.raw.run(
      "UPDATE agent_questions SET continuation = 'interrupted', revision = revision + 1 WHERE continuation = 'unconfirmed'",
    )
    retireClosedApprovals(db, now)
  })()
}

/** The canonical approval repository owns terminal state and its audit event. */
function retireClosedApprovals(db: BazilionDb, now: number): void {
  communicationApprovals.expirePending(db, now)
  const rows = db.raw
    .query<{ id: string }, []>(`
    SELECT DISTINCT a.id FROM communication_approvals a
    JOIN agent_questions q ON a.id IN (q.delivery_approval_id, q.answer_approval_id)
    WHERE q.status != 'pending' AND a.status = 'pending'
      AND a.payload_kind IN ('question_delivery', 'question_answer')
  `)
    .all()
  for (const row of rows)
    communicationApprovals.decide(
      db,
      row.id,
      'cancel',
      'system',
      'Originating question is closed',
      now,
    )
}
export function prune(db: BazilionDb, now = Date.now()): void {
  db.raw.run(
    `DELETE FROM agent_questions WHERE settled_at < ? AND status != 'pending'
    AND continuation IN ('consumed','interrupted') AND NOT EXISTS
    (SELECT 1 FROM communication_approvals a WHERE a.id IN (delivery_approval_id, answer_approval_id)
     AND a.status IN ('pending','approved','delivering'))`,
    [now - QUESTION_LIMITS.terminalRetentionMs],
  )
}

export interface QuestionApprovalSnapshot {
  question: AgentQuestion
  deliveryDigest: string
  proposal: AgentQuestionResponseInput | null
  proposalDigest: string | null
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Reference-only approvals bind content plus its original daemon-owned route. */
export function approvalSnapshot(
  db: BazilionDb,
  agentId: string,
  id: string,
): QuestionApprovalSnapshot | null {
  const question = get(db, agentId, id)
  if (!question) return null
  const row = db.raw
    .query<{ binding_json: string; proposal_json: string | null }, [string]>(
      'SELECT binding_json, proposal_json FROM agent_questions WHERE id = ?',
    )
    .get(id)
  if (
    !row ||
    Buffer.byteLength(row.binding_json) > 16_384 ||
    (row.proposal_json && Buffer.byteLength(row.proposal_json) > 32_768)
  )
    throw new Error('Question binding unavailable')
  const proposal = row.proposal_json
    ? parseQuestionResponse(
        JSON.parse(row.proposal_json),
        question.question,
        question.conversationId,
      )
    : null
  const deliveryDigest = digest({
    id,
    agentId,
    teamId: question.teamId,
    conversationId: question.conversationId,
    turnId: question.turnId,
    toolCallId: question.toolCallId,
    question: question.question,
    binding: JSON.parse(row.binding_json),
  })
  return {
    question,
    deliveryDigest,
    proposal,
    proposalDigest: proposal ? digest({ deliveryDigest, proposal }) : null,
  }
}

/** Reserve one immutable proposed reply before authorizing it; this is not answer acceptance. */
export function proposeAnswer(
  db: BazilionDb,
  agentId: string,
  id: string,
  value: AgentQuestionResponseInput,
  now = Date.now(),
): boolean {
  return db.raw.transaction(() => {
    const snapshot = approvalSnapshot(db, agentId, id)
    if (!snapshot) throw new Error('Question unavailable')
    const input = parseQuestionResponse(
      value,
      snapshot.question.question,
      snapshot.question.conversationId,
    )
    if (
      snapshot.question.status !== 'pending' ||
      snapshot.question.expiresAt <= now ||
      snapshot.question.deliveredAt === null
    )
      return false
    if (snapshot.proposal) return JSON.stringify(snapshot.proposal) === JSON.stringify(input)
    db.raw.run(
      'UPDATE agent_questions SET proposal_json = ?, revision = revision + 1 WHERE id = ?',
      [JSON.stringify(input), id],
    )
    return true
  })()
}

export function linkApproval(
  db: BazilionDb,
  agentId: string,
  id: string,
  kind: 'question_delivery' | 'question_answer',
  approvalId: string,
): void {
  const column = kind === 'question_delivery' ? 'delivery_approval_id' : 'answer_approval_id'
  const changed = db.raw.run(
    `UPDATE agent_questions SET ${column} = ?, revision = revision + 1
    WHERE agent_id = ? AND id = ? AND status = 'pending' AND (${column} IS NULL OR ${column} = ?)`,
    [approvalId, agentId, id, approvalId],
  )
  if (!changed.changes) throw new Error('Question approval ownership changed')
}

/** Called by the authorized delivery owner, never by a card read or a worker flag. */
export function markDelivered(
  db: BazilionDb,
  agentId: string,
  id: string,
  now = Date.now(),
  approvalId?: string,
): AgentQuestion {
  const item = required(db, agentId, id)
  if (!ownsApproval(db, item.deliveryApprovalId, approvalId))
    throw new Error('Question delivery belongs to its canonical approval')
  db.raw.run(
    `UPDATE agent_questions SET delivered_at = ?, revision = revision + 1
    WHERE agent_id = ? AND id = ? AND status = 'pending' AND delivered_at IS NULL AND expires_at > ?`,
    [now, agentId, id, now],
  )
  return required(db, agentId, id)
}

function ownsApproval(db: BazilionDb, capturedId: string | null, providedId?: string): boolean {
  if (!capturedId) return providedId === undefined
  if (capturedId !== providedId) return false
  return (
    db.raw
      .query<{ status: string }, [string]>(
        'SELECT status FROM communication_approvals WHERE id = ?',
      )
      .get(capturedId)?.status === 'delivering'
  )
}
