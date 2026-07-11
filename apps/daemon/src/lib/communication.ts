import { randomUUID } from 'node:crypto'
import type { ChatFrame, Message } from '@bazilion/api-types'
import {
  type AuthorizationInput,
  type AuthorizationResult,
  agentRepo,
  authorizeInSnapshot,
  type BazilionDb,
  messageRepo,
  recordDenial,
  triggerRepo,
} from '../core/index.ts'
import { harnessEnforcementRequested } from './harness-contract.ts'

export const communicationDecisionMetrics = { allowed: 0, denied: 0 }

function observeDenial(result: AuthorizationResult, attempt: CommunicationAttempt): void {
  communicationDecisionMetrics.denied++
  console.warn(
    JSON.stringify({
      event: 'harness_communication_denied',
      attemptKind: attempt.attemptKind,
      attemptId: attempt.attemptId,
      channel: result.channel,
      reasonCode: result.reasonCode,
      policyRefs: result.policyRefs,
    }),
  )
}

export function harnessEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return harnessEnforcementRequested(env)
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

export interface CommunicationAttempt {
  origin: string
  attemptKind: string
  attemptId: string
}

function authorizeBoundary(
  db: BazilionDb,
  input: AuthorizationInput,
  operation: string,
  onAllowed?: () => void,
): AuthorizationResult {
  if (!harnessEnforcementEnabled()) {
    onAllowed?.()
    return {
      decision: 'allow',
      channel: 'user',
      reasonCode: 'enforcement_disabled',
      reason: 'Harness enforcement is disabled',
      policyRefs: [],
      componentOutcomes: [],
      matchedEdgeIds: [],
      requiredEdgeIds: [],
    }
  }
  const outcome = db.raw.transaction(() => {
    const result = authorizeInSnapshot(db, input)
    if (result.decision === 'deny') return recordDenial(db, input, operation, result)
    onAllowed?.()
    return result
  })()
  if (outcome.decision === 'deny') {
    observeDenial(outcome, input)
    throw new CommunicationDeniedError(outcome, input.attemptKind, input.attemptId)
  }
  communicationDecisionMetrics.allowed++
  return outcome
}

export function authorizeUserIngress(
  db: BazilionDb,
  agentId: string,
  attempt: CommunicationAttempt,
  onAllowed?: () => void,
): AuthorizationResult {
  const agent = agentRepo.get(db, agentId)
  const groupId = agent?.groupId ?? '__missing__'
  return authorizeBoundary(
    db,
    {
      source: { kind: 'user', groupId },
      target: { kind: 'agent', id: agentId },
      ...attempt,
    },
    'user_to_agent',
    onAllowed,
  )
}

export function authorizeAgentEgress(
  db: BazilionDb,
  agentId: string,
  attempt: CommunicationAttempt,
): AuthorizationResult {
  const agent = agentRepo.get(db, agentId)
  const groupId = agent?.groupId ?? '__missing__'
  return authorizeBoundary(
    db,
    {
      source: { kind: 'agent', id: agentId },
      target: { kind: 'user', groupId },
      ...attempt,
    },
    'agent_to_user',
  )
}

export function authorizeHttpChatFrame(
  db: BazilionDb,
  agentId: string,
  requestAttemptId: string,
  frameIndex: number,
  frame: ChatFrame,
): void {
  if (!isUserFacingFrame(frame)) return
  authorizeAgentEgress(db, agentId, {
    origin: 'http_chat',
    attemptKind: 'http_chat_frame',
    attemptId: `${requestAttemptId}:${frameIndex}`,
  })
}

function isUserFacingFrame(frame: ChatFrame): boolean {
  if (frame.kind === 'fatal') return true
  if (frame.kind !== 'event') return false
  return (
    frame.event.type === 'assistant_message' ||
    frame.event.type === 'assistant_delta' ||
    frame.event.type === 'file' ||
    (frame.event.type === 'tool_result' && Boolean(frame.event.images?.length)) ||
    frame.event.type === 'error'
  )
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
    observeDenial(outcome.denial, { origin: input.origin, attemptKind, attemptId })
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
        const denial = recordDenial(db, authorization, 'deliver_agent_message', result)
        observeDenial(denial, authorization)
        messageRepo.markPolicyBlocked(db, message.id)
      }
    }
    return deliverable
  })()
}

export function deliverableReplies(db: BazilionDb, agentId: string, replyTo: string): Message[] {
  return deliverableInbox(db, agentId, false).filter((message) => message.replyTo === replyTo)
}

export function claimSchedulerTrigger(
  db: BazilionDb,
  input: { triggerId: string; agentId: string; occurrence: number; onAllowed?: () => void },
): boolean {
  if (!harnessEnforcementEnabled()) {
    return db.raw.transaction(() => {
      const current = triggerRepo.get(db, input.triggerId)
      if (!current) throw new Error(`trigger not found: ${input.triggerId}`)
      if (current.lastFiredAt !== null && current.lastFiredAt >= input.occurrence) {
        return false
      }
      triggerRepo.markFired(db, input.triggerId, input.occurrence)
      input.onAllowed?.()
      return true
    })()
  }
  const attempt: CommunicationAttempt = {
    origin: 'scheduler_trigger',
    attemptKind: 'scheduler_trigger',
    attemptId: `${input.triggerId}:${input.occurrence}`,
  }
  const outcome = db.raw.transaction((): { result: AuthorizationResult; claimed: boolean } => {
    const current = triggerRepo.get(db, input.triggerId)
    if (!current) throw new Error(`trigger not found: ${input.triggerId}`)
    if (current.lastFiredAt !== null && current.lastFiredAt >= input.occurrence) {
      return {
        claimed: false,
        result: {
          decision: 'allow',
          channel: 'user',
          reasonCode: 'occurrence_already_claimed',
          reason: 'Scheduler occurrence was already claimed',
          policyRefs: [],
          componentOutcomes: [],
          matchedEdgeIds: [],
          requiredEdgeIds: [],
        },
      }
    }
    const agent = agentRepo.get(db, input.agentId)
    const authorization: AuthorizationInput = {
      source: { kind: 'user', groupId: agent?.groupId ?? '__missing__' },
      target: { kind: 'agent', id: input.agentId },
      ...attempt,
    }
    const result = authorizeInSnapshot(db, authorization)
    triggerRepo.markFired(db, input.triggerId, input.occurrence)
    if (result.decision === 'deny') {
      return {
        claimed: true,
        result: recordDenial(db, authorization, 'scheduler_trigger', result),
      }
    }
    input.onAllowed?.()
    return { claimed: true, result }
  })()
  if (outcome.result.decision === 'deny') {
    observeDenial(outcome.result, attempt)
    throw new CommunicationDeniedError(outcome.result, attempt.attemptKind, attempt.attemptId)
  }
  if (outcome.claimed) communicationDecisionMetrics.allowed++
  return outcome.claimed
}

export function claimDeliverableInbox(
  db: BazilionDb,
  agentId: string,
  onAllowed?: () => void,
): Message[] {
  if (!harnessEnforcementEnabled()) {
    const messages = messageRepo.drainUnreadForAgent(db, agentId)
    if (messages.length > 0) onAllowed?.()
    return messages
  }
  const outcome = db.raw.transaction(() => {
    const messages = messageRepo.listInbox(db, agentId, { unreadOnly: true })
    const allowed: Message[] = []
    const denials: Array<{ result: AuthorizationResult; attempt: AuthorizationInput }> = []
    for (const message of messages) {
      const authorization: AuthorizationInput = {
        source: { kind: 'agent', id: message.fromAgentId },
        target: { kind: 'agent', id: message.toAgentId },
        origin: 'scheduler_inbox',
        attemptKind: 'inbox',
        attemptId: message.id,
      }
      const result = authorizeInSnapshot(db, authorization)
      if (result.decision === 'allow') {
        const claimedAt = Date.now()
        messageRepo.markPolicyClaimed(db, message.id, claimedAt)
        allowed.push({ ...message, readAt: claimedAt })
      } else {
        const denial = recordDenial(db, authorization, 'deliver_agent_message', result)
        denials.push({ result: denial, attempt: authorization })
        messageRepo.markPolicyBlocked(db, message.id)
      }
    }
    if (allowed.length > 0) onAllowed?.()
    const deliveredAt = Date.now()
    for (const message of allowed) {
      messageRepo.markPolicyDelivered(db, message.id, deliveredAt)
    }
    return { allowed, denials }
  })()
  communicationDecisionMetrics.allowed += outcome.allowed.length
  for (const denial of outcome.denials) observeDenial(denial.result, denial.attempt)
  return outcome.allowed
}
