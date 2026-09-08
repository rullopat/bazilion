import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { agentRepo, authorizeInSnapshot, type BazilionDb } from '../core/index.ts'
import { teamPolicyEnforcementEnabled } from './communication.ts'
import { verifyQuestionReceipt } from './question-receipt.ts'

/** Public history permission, bound to the daemon-resolved Agent and conversation. */
export function questionHistoryVisibility(db: BazilionDb, agentId: string, conversationId: string) {
  return (message: AgentMessage): boolean => {
    if (message.role !== 'toolResult' || message.toolName !== 'ask_user' || message.isError)
      return false
    if (message.content.length !== 1 || message.content[0]?.type !== 'text') return false
    const details = message.details as { questionReceipt?: unknown } | undefined
    const receipt = verifyQuestionReceipt(db, details?.questionReceipt, message.content[0].text)
    if (
      !receipt ||
      receipt.agentId !== agentId ||
      receipt.conversationId !== conversationId ||
      receipt.toolCallId !== message.toolCallId
    )
      return false
    const agent = agentRepo.get(db, agentId)
    if (!agent || agent.teamId !== receipt.teamId) return false
    if (!teamPolicyEnforcementEnabled()) return true
    const decision = authorizeInSnapshot(db, {
      source: { kind: 'agent', id: agentId },
      target: { kind: 'user', teamId: receipt.teamId },
      origin: 'agent_question',
      attemptKind: 'question_delivery',
      attemptId: `${receipt.questionId}:history`,
    })
    if (decision.decision === 'allow') return true
    return (
      decision.decision === 'approval_required' &&
      receipt.approvalPolicy !== null &&
      JSON.stringify(decision.policyRefs) === JSON.stringify(receipt.approvalPolicy.refs) &&
      JSON.stringify(decision.requiredEdgeIds) === JSON.stringify(receipt.approvalPolicy.edgeIds)
    )
  }
}
