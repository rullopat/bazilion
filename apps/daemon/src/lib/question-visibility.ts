import type { AgentQuestion } from '@bazilion/api-types'
import { agentRepo, authorizeInSnapshot, type BazilionDb } from '../core/index.ts'
import * as approvals from '../core/repos/communicationApprovals.ts'
import * as questions from '../core/repos/questions.ts'
import { teamPolicyEnforcementEnabled } from './communication.ts'
import { validateQuestionApproval } from './question-approval.ts'

/** Reload reads cannot release a held question or manufacture a new approval attempt. */
export function questionVisible(db: BazilionDb, item: AgentQuestion): boolean {
  const agent = agentRepo.get(db, item.agentId)
  if (!agent || agent.teamId !== item.teamId || item.deliveredAt === null) return false
  if (!teamPolicyEnforcementEnabled()) return true
  const decision = authorizeInSnapshot(db, {
    source: { kind: 'agent', id: item.agentId },
    target: { kind: 'user', teamId: item.teamId },
    origin: 'agent_question',
    attemptKind: 'question_delivery',
    attemptId: `${item.id}:delivery`,
  })
  if (decision.decision === 'allow') return true
  if (decision.decision !== 'approval_required' || !item.deliveryApprovalId) return false
  const approval = approvals.get(db, item.deliveryApprovalId, true)
  if (
    !approval ||
    !('payload' in approval) ||
    !['delivering', 'delivered'].includes(approval.status)
  )
    return false
  try {
    validateQuestionApproval(approval, questions.approvalSnapshot(db, item.agentId, item.id))
    return (
      JSON.stringify(decision.policyRefs) === JSON.stringify(approval.policyRefs) &&
      JSON.stringify(decision.requiredEdgeIds) === JSON.stringify(approval.requiredEdgeIds)
    )
  } catch {
    return false
  }
}
