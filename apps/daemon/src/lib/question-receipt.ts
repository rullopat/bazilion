import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { AgentQuestionToolResult, CommunicationPolicyRef } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import * as approvals from '../core/repos/communicationApprovals.ts'
import * as questions from '../core/repos/questions.ts'
import { validateQuestionApproval } from './question-approval.ts'

export interface QuestionReceipt {
  version: 1
  agentId: string
  teamId: string
  conversationId: string
  toolCallId: string
  questionId: string
  deliveredAt: number
  resultDigest: string
  approvalPolicy: { refs: CommunicationPolicyRef[]; edgeIds: string[] } | null
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function key(db: BazilionDb, create: boolean): Buffer | null {
  if (create)
    db.raw.run('INSERT OR IGNORE INTO question_receipt_key (singleton, key) VALUES (1, ?)', [
      randomBytes(32),
    ])
  const row = db.raw
    .query<{ key: Uint8Array }, []>('SELECT key FROM question_receipt_key WHERE singleton = 1')
    .get()
  return row ? Buffer.from(row.key) : null
}

/** Sign only an exact settled result whose question was actually released by its owner. */
export function signQuestionReceipt(
  db: BazilionDb,
  agentId: string,
  result: AgentQuestionToolResult,
): string | undefined {
  const item = questions.get(db, agentId, result.questionId)
  if (!item || item.deliveredAt === null || item.status === 'pending') return undefined
  const expected: AgentQuestionToolResult =
    item.status === 'answered' && item.answer && item.answer.kind !== 'skip'
      ? { questionId: item.id, question: item.question, kind: 'answer', answer: item.answer }
      : {
          questionId: item.id,
          question: item.question,
          kind: 'no_answer',
          reason: item.noAnswerReason ?? 'cancelled',
        }
  if (!isDeepStrictEqual(result, expected)) throw new Error('Question receipt outcome differs')
  let approvalPolicy: QuestionReceipt['approvalPolicy'] = null
  if (item.deliveryApprovalId) {
    const approval = approvals.get(db, item.deliveryApprovalId, true)
    if (
      !approval ||
      !('payload' in approval) ||
      !['delivering', 'delivered'].includes(approval.status)
    )
      return undefined
    validateQuestionApproval(approval, questions.approvalSnapshot(db, agentId, item.id))
    approvalPolicy = { refs: approval.policyRefs, edgeIds: approval.requiredEdgeIds }
  }
  const payload: QuestionReceipt = {
    version: 1,
    agentId,
    teamId: item.teamId,
    conversationId: item.conversationId,
    toolCallId: item.toolCallId,
    questionId: item.id,
    deliveredAt: item.deliveredAt,
    resultDigest: hash(JSON.stringify(result)),
    approvalPolicy,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingKey = key(db, true)
  if (!signingKey) throw new Error('Question receipt key unavailable')
  return `v1.${encoded}.${createHmac('sha256', signingKey).update(encoded).digest('hex')}`
}

/** A receipt authorizes no new delivery; consumers must also check current policy and identity. */
export function verifyQuestionReceipt(
  db: BazilionDb,
  receipt: unknown,
  resultText: string,
): QuestionReceipt | null {
  if (typeof receipt !== 'string' || receipt.length > 8192) return null
  const [version, encoded, signature, extra] = receipt.split('.')
  if (
    version !== 'v1' ||
    !encoded ||
    !signature ||
    extra !== undefined ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null
  const signingKey = key(db, false)
  if (!signingKey) return null
  const expected = createHmac('sha256', signingKey).update(encoded).digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as QuestionReceipt
    if (payload.version !== 1 || payload.resultDigest !== hash(resultText)) return null
    return payload
  } catch {
    return null
  }
}
