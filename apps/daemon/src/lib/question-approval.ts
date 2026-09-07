import type { AgentQuestionResponseInput, CommunicationApprovalDetail } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import type { QuestionApprovalSnapshot } from '../core/repos/questions.ts'
import * as questions from '../core/repos/questions.ts'
import {
  authorizeAgentEgress,
  authorizeUserIngress,
  CommunicationDeniedError,
  CommunicationPendingError,
} from './communication.ts'

export type QuestionApprovalKind = 'question_delivery' | 'question_answer'
export interface QuestionApprovalReference {
  agentId: string
  questionId: string
  inputDigest: string
}
export function questionApprovalReference(
  snapshot: QuestionApprovalSnapshot,
  kind: QuestionApprovalKind,
): QuestionApprovalReference {
  const inputDigest =
    kind === 'question_delivery' ? snapshot.deliveryDigest : snapshot.proposalDigest
  if (!inputDigest) throw new Error('Question answer proposal unavailable')
  return { agentId: snapshot.question.agentId, questionId: snapshot.question.id, inputDigest }
}

/** Closed validation of the complete source-owned tuple, without loading a second payload copy. */
export function validateQuestionApproval(
  approval: CommunicationApprovalDetail,
  snapshot: QuestionApprovalSnapshot | null,
): { kind: QuestionApprovalKind; reference: QuestionApprovalReference } {
  const invalid = (): never => {
    throw new Error('Invalid question approval binding')
  }
  if (!snapshot) return invalid()
  const kind = approval.payloadKind
  if (kind !== 'question_delivery' && kind !== 'question_answer') return invalid()
  const expected = questionApprovalReference(snapshot, kind)
  const payload = approval.payload as Partial<QuestionApprovalReference> | null
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== 'agentId,inputDigest,questionId' ||
    payload.agentId !== expected.agentId ||
    payload.questionId !== expected.questionId ||
    payload.inputDigest !== expected.inputDigest
  )
    return invalid()
  const question = snapshot.question
  const delivery = kind === 'question_delivery'
  const approvalId = delivery ? question.deliveryApprovalId : question.answerApprovalId
  if (
    approval.id !== approvalId ||
    approval.origin !== 'agent_question' ||
    approval.attemptKind !== kind ||
    approval.attemptId !==
      (delivery
        ? `${question.id}:delivery`
        : `${question.id}:answer:${snapshot.proposal?.requestId}`) ||
    approval.operation !== (delivery ? 'agent_to_user' : 'user_to_agent')
  )
    return invalid()
  const agent = delivery ? approval.source : approval.target
  const user = delivery ? approval.target : approval.source
  if (
    agent.kind !== 'agent' ||
    agent.id !== question.agentId ||
    user.kind !== 'user' ||
    user.teamId !== question.teamId ||
    approval.channel !== 'user' ||
    approval.sourceTeamId !== question.teamId ||
    approval.targetTeamId !== question.teamId
  )
    return invalid()
  return { kind, reference: expected }
}

export type QuestionBoundaryResult =
  | { kind: 'allowed' }
  | { kind: 'held'; approvalId: string }
  | { kind: 'conflict' }

/** Capture a source-owned hold atomically with the immutable proposal/reference linkage. */
export function authorizeQuestionBoundary(
  db: BazilionDb,
  agentId: string,
  questionId: string,
  kind: QuestionApprovalKind,
  response?: AgentQuestionResponseInput,
  now = Date.now(),
): QuestionBoundaryResult {
  const result = db.raw.transaction((): QuestionBoundaryResult | CommunicationDeniedError => {
    let snapshot = questions.approvalSnapshot(db, agentId, questionId)
    if (snapshot?.question.status !== 'pending' || snapshot.question.expiresAt <= now)
      return { kind: 'conflict' }
    if (kind === 'question_answer') {
      if (!response || !questions.proposeAnswer(db, agentId, questionId, response, now))
        return { kind: 'conflict' }
      snapshot = questions.approvalSnapshot(db, agentId, questionId)
      if (!snapshot) throw new Error('Question unavailable')
    }
    const existing =
      kind === 'question_delivery'
        ? snapshot.question.deliveryApprovalId
        : snapshot.question.answerApprovalId
    // Once held, changing policy cannot create a competing direct delivery owner.
    if (existing) return { kind: 'held', approvalId: existing }
    const attempt = {
      origin: 'agent_question',
      attemptKind: kind,
      attemptId:
        kind === 'question_delivery'
          ? `${questionId}:delivery`
          : `${questionId}:answer:${snapshot.proposal?.requestId}`,
      approvalPayloadKind: kind,
      approvalPayload: questionApprovalReference(snapshot, kind),
      approvalExpiresAt: snapshot.question.expiresAt,
      requester: kind === 'question_delivery' ? agentId : 'authenticated_operator',
    }
    try {
      if (kind === 'question_delivery') authorizeAgentEgress(db, agentId, attempt)
      else authorizeUserIngress(db, agentId, attempt)
      return { kind: 'allowed' }
    } catch (error) {
      if (error instanceof CommunicationPendingError) {
        questions.linkApproval(db, agentId, questionId, kind, error.approval.id)
        return { kind: 'held', approvalId: error.approval.id }
      }
      // Commit the shared author's payload-free block evidence before surfacing denial.
      if (error instanceof CommunicationDeniedError) return error
      throw error
    }
  })()
  if (result instanceof CommunicationDeniedError) throw result
  return result
}
