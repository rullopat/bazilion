import { randomUUID } from 'node:crypto'
import type { Message } from '@bazilion/api-types'
import {
  type AuthorizationInput,
  type AuthorizationResult,
  authorizeInSnapshot,
  type BazilionDb,
  messageRepo,
  recordDenial,
} from '../core/index.ts'

export const communicationDecisionMetrics = { allowed: 0, denied: 0 }

export function harnessEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BAZILION_HARNESS_ENFORCEMENT === 'on'
}

export class CommunicationDeniedError extends Error {
  constructor(
    readonly result: AuthorizationResult,
    readonly attemptKind: string,
    readonly attemptId: string,
  ) {
    super(JSON.stringify({ ...result, attemptKind, attemptId }))
    this.name = 'CommunicationDeniedError'
  }
}

export interface SendAgentMessageInput {
  from: string
  to: string
  payload: string
  replyTo?: string | null
  origin: string
  attemptKind?: string
  attemptId?: string
}

export function sendAgentMessage(db: BazilionDb, input: SendAgentMessageInput): Message {
  if (!harnessEnforcementEnabled()) return messageRepo.send(db, input)
  const attemptKind = input.attemptKind ?? 'agent_tool'
  const attemptId = input.attemptId ?? randomUUID()
  const outcome = db.raw.transaction((): { message?: Message; denial?: AuthorizationResult } => {
    const authorization: AuthorizationInput = {
      source: { kind: 'agent', id: input.from },
      target: { kind: 'agent', id: input.to },
      origin: input.origin,
      attemptKind,
      attemptId,
    }
    const result = authorizeInSnapshot(db, authorization)
    if (result.decision === 'deny') {
      const durable = recordDenial(db, authorization, 'send_agent_message', result)
      return { denial: durable }
    }
    return { message: messageRepo.send(db, input) }
  })()
  if (outcome.denial) {
    communicationDecisionMetrics.denied++
    console.warn(
      JSON.stringify({
        event: 'harness_communication_denied',
        attemptKind,
        attemptId,
        channel: outcome.denial.channel,
        reasonCode: outcome.denial.reasonCode,
        policyRefs: outcome.denial.policyRefs,
      }),
    )
    throw new CommunicationDeniedError(outcome.denial, attemptKind, attemptId)
  }
  if (!outcome.message) throw new Error('communication transaction produced no result')
  communicationDecisionMetrics.allowed++
  return outcome.message
}

export function deliverableInbox(db: BazilionDb, agentId: string, unreadOnly: boolean): Message[] {
  if (!harnessEnforcementEnabled()) return messageRepo.listInbox(db, agentId, { unreadOnly })
  return db.raw.transaction(() => {
    const messages = messageRepo.listInbox(db, agentId, { unreadOnly })
    const deliverable: Message[] = []
    for (const message of messages) {
      const authorization: AuthorizationInput = {
        source: { kind: 'agent', id: message.fromAgentId },
        target: { kind: 'agent', id: message.toAgentId },
        origin: 'agent_inbox',
        attemptKind: 'inbox',
        attemptId: message.id,
      }
      const result = authorizeInSnapshot(db, authorization)
      if (result.decision === 'allow') deliverable.push(message)
      else {
        recordDenial(db, authorization, 'deliver_agent_message', result)
        messageRepo.markPolicyBlocked(db, message.id)
      }
    }
    return deliverable
  })()
}

export function deliverableReplies(db: BazilionDb, agentId: string, replyTo: string): Message[] {
  return deliverableInbox(db, agentId, false).filter((message) => message.replyTo === replyTo)
}
