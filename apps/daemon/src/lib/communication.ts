import { randomUUID } from 'node:crypto'
import type {
  ChatFrame,
  CommunicationApproval,
  CommunicationApprovalDetail,
  Message,
} from '@bazilion/api-types'
import {
  type AuthorizationInput,
  type AuthorizationResult,
  agentRepo,
  authorizeInSnapshot,
  type BazilionDb,
  communicationApprovalRepo,
  messageRepo,
  recordDenial,
  triggerRepo,
} from '../core/index.ts'
import { teamPolicyEnforcementRequested } from './team-policy-contract.ts'

export const communicationDecisionMetrics = { allowed: 0, denied: 0 }

function observeDenial(result: AuthorizationResult, attempt: CommunicationAttempt): void {
  communicationDecisionMetrics.denied++
  console.warn(
    JSON.stringify({
      event: 'teamPolicy_communication_denied',
      attemptKind: attempt.attemptKind,
      attemptId: attempt.attemptId,
      channel: result.channel,
      reasonCode: result.reasonCode,
      policyRefs: result.policyRefs,
    }),
  )
}

export function teamPolicyEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return teamPolicyEnforcementRequested(env)
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

export class CommunicationPendingError extends Error {
  constructor(readonly approval: CommunicationApproval) {
    super(
      JSON.stringify({
        decision: 'approval_required',
        approvalId: approval.id,
        status: approval.status,
        expiresAt: approval.expiresAt,
        attemptKind: approval.attemptKind,
        attemptId: approval.attemptId,
      }),
    )
    this.name = 'CommunicationPendingError'
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
  approvalPayloadKind?: string
  approvalPayload?: unknown
  requester?: string
}

function authorizeBoundary(
  db: BazilionDb,
  input: AuthorizationInput,
  operation: string,
  onAllowed?: () => void,
): AuthorizationResult {
  if (!teamPolicyEnforcementEnabled()) {
    onAllowed?.()
    return {
      decision: 'allow',
      channel: 'user',
      reasonCode: 'enforcement_disabled',
      reason: 'TeamPolicy enforcement is disabled',
      policyRefs: [],
      componentOutcomes: [],
      matchedEdgeIds: [],
      requiredEdgeIds: [],
    }
  }
  const outcome = db.raw.transaction(() => {
    const result = authorizeInSnapshot(db, input)
    if (result.decision === 'deny') return recordDenial(db, input, operation, result)
    if (result.decision === 'allow') onAllowed?.()
    return result
  })()
  if (outcome.decision === 'deny') {
    observeDenial(outcome, input)
    throw new CommunicationDeniedError(outcome, input.attemptKind, input.attemptId)
  }
  if (outcome.decision === 'approval_required') {
    const approval = communicationApprovalRepo.request(
      db,
      input,
      operation,
      outcome,
      input.approvalPayloadKind ?? operation,
      input.approvalPayload ?? {},
      { requester: input.requester ?? input.origin },
    )
    throw new CommunicationPendingError(approval)
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
  const teamId = agent?.teamId ?? '__missing__'
  return authorizeBoundary(
    db,
    {
      source: { kind: 'user', teamId },
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
  const teamId = agent?.teamId ?? '__missing__'
  return authorizeBoundary(
    db,
    {
      source: { kind: 'agent', id: agentId },
      target: { kind: 'user', teamId },
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
    approvalPayloadKind: 'http_chat_frame',
    approvalPayload: { agentId, frame },
    requester: agentId,
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
  if (!teamPolicyEnforcementEnabled()) return messageRepo.send(db, input)
  const attemptKind = input.attemptKind ?? 'agent_tool'
  const attemptId = input.attemptId ?? randomUUID()
  const outcome = db.raw.transaction(
    (): {
      message?: Message
      denial?: AuthorizationResult
      approval?: { authorization: AuthorizationResult; input: AuthorizationInput }
    } => {
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
      if (result.decision === 'approval_required') {
        return { approval: { authorization: result, input: authorization } }
      }
      return { message: messageRepo.send(db, input) }
    },
  )()
  if (outcome.denial) {
    observeDenial(outcome.denial, { origin: input.origin, attemptKind, attemptId })
    throw new CommunicationDeniedError(outcome.denial, attemptKind, attemptId)
  }
  if (outcome.approval) {
    const approval = communicationApprovalRepo.request(
      db,
      outcome.approval.input,
      'send_agent_message',
      outcome.approval.authorization,
      'agent_message',
      {
        from: input.from,
        to: input.to,
        payload: input.payload,
        replyTo: input.replyTo ?? null,
      },
      { requester: input.from },
    )
    throw new CommunicationPendingError(approval)
  }
  if (!outcome.message) throw new Error('communication transaction produced no result')
  communicationDecisionMetrics.allowed++
  return outcome.message
}

export function deliverableInbox(db: BazilionDb, agentId: string, unreadOnly: boolean): Message[] {
  if (!teamPolicyEnforcementEnabled()) return messageRepo.listInbox(db, agentId, { unreadOnly })
  const outcome = db.raw.transaction(() => {
    const messages = messageRepo.listInbox(db, agentId, { unreadOnly })
    const deliverable: Message[] = []
    const approvals: Array<{
      authorization: AuthorizationInput
      result: AuthorizationResult
      message: Message
    }> = []
    for (const message of messages) {
      const granted =
        db.raw
          .query<{ found: number }, [string]>(
            'SELECT 1 found FROM communication_approval_message_grants WHERE message_id = ?',
          )
          .get(message.id) !== null
      const authorization: AuthorizationInput = {
        source: { kind: 'agent', id: message.fromAgentId },
        target: { kind: 'agent', id: message.toAgentId },
        origin: 'agent_inbox',
        attemptKind: 'inbox',
        attemptId: message.id,
      }
      const result = authorizeInSnapshot(db, authorization)
      if (result.decision === 'allow' || (result.decision === 'approval_required' && granted))
        deliverable.push(message)
      else if (result.decision === 'approval_required') {
        approvals.push({ authorization, result, message })
      } else {
        const denial = recordDenial(db, authorization, 'deliver_agent_message', result)
        observeDenial(denial, authorization)
        messageRepo.markPolicyBlocked(db, message.id)
      }
    }
    return { deliverable, approvals }
  })()
  for (const pending of outcome.approvals) {
    communicationApprovalRepo.request(
      db,
      pending.authorization,
      'deliver_agent_message',
      pending.result,
      'inbox_message',
      { messageId: pending.message.id },
      { requester: pending.message.fromAgentId },
    )
  }
  return outcome.deliverable
}

export function deliverableReplies(db: BazilionDb, agentId: string, replyTo: string): Message[] {
  return deliverableInbox(db, agentId, false).filter((message) => message.replyTo === replyTo)
}

export type SchedulerTriggerClaim =
  | { kind: 'claimed' }
  | { kind: 'already_claimed' }
  | { kind: 'approval_pending'; approval: CommunicationApproval }
  | { kind: 'approval_terminal'; approval: CommunicationApproval; reason: string }

export function claimSchedulerTrigger(
  db: BazilionDb,
  input: {
    dispatchId?: string
    triggerId: string
    agentId: string
    occurrence: number
    materialized?: boolean
    onAllowed?: () => void
  },
): SchedulerTriggerClaim {
  const attempt: CommunicationAttempt = {
    origin: 'scheduler_trigger',
    attemptKind: 'scheduler_trigger',
    attemptId: `${input.triggerId}:${input.occurrence}`,
  }
  const existingApproval = communicationApprovalRepo.getByAttempt(
    db,
    attempt.attemptKind,
    attempt.attemptId,
    true,
  ) as CommunicationApprovalDetail | null
  const existingPayload = existingApproval?.payload as
    | {
        dispatchId?: unknown
        triggerId?: unknown
        occurrence?: unknown
        agentId?: unknown
        message?: unknown
      }
    | undefined
  if (
    existingApproval &&
    (existingApproval.operation !== 'scheduler_trigger' ||
      existingApproval.payloadKind !== 'scheduler_trigger' ||
      !existingPayload ||
      existingPayload.dispatchId !== input.dispatchId ||
      existingPayload.triggerId !== input.triggerId ||
      existingPayload.occurrence !== input.occurrence ||
      existingPayload.agentId !== input.agentId ||
      typeof existingPayload.message !== 'string')
  ) {
    return {
      kind: 'approval_terminal',
      approval: existingApproval,
      reason: 'scheduler approval does not match the durable occurrence',
    }
  }
  if (existingApproval && ['pending', 'approved', 'delivering'].includes(existingApproval.status)) {
    return { kind: 'approval_pending', approval: existingApproval }
  }
  if (existingApproval && existingApproval.status !== 'delivered') {
    return {
      kind: 'approval_terminal',
      approval: existingApproval,
      reason:
        existingApproval.deliveryError ??
        existingApproval.decisionReason ??
        `scheduler approval ${existingApproval.status}`,
    }
  }

  if (!teamPolicyEnforcementEnabled()) {
    return db.raw.transaction(() => {
      const current = triggerRepo.get(db, input.triggerId)
      if (!current) throw new Error(`trigger not found: ${input.triggerId}`)
      if (
        !input.materialized &&
        current.lastFiredAt !== null &&
        current.lastFiredAt >= input.occurrence
      ) {
        return { kind: 'already_claimed' as const }
      }
      if (current.lastFiredAt === null || current.lastFiredAt < input.occurrence) {
        triggerRepo.markFired(db, input.triggerId, input.occurrence)
      }
      input.onAllowed?.()
      communicationDecisionMetrics.allowed++
      return { kind: 'claimed' as const }
    })()
  }
  const outcome = db.raw.transaction(
    (): {
      result: AuthorizationResult
      claimed: boolean
      approval?: { authorization: AuthorizationResult; input: AuthorizationInput; message: string }
      invalidApproval?: string
    } => {
      const current = triggerRepo.get(db, input.triggerId)
      if (!current) throw new Error(`trigger not found: ${input.triggerId}`)
      if (
        !input.materialized &&
        current.lastFiredAt !== null &&
        current.lastFiredAt >= input.occurrence
      ) {
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
        source: { kind: 'user', teamId: agent?.teamId ?? '__missing__' },
        target: { kind: 'agent', id: input.agentId },
        ...attempt,
      }
      const result = authorizeInSnapshot(db, authorization)
      if (current.lastFiredAt === null || current.lastFiredAt < input.occurrence) {
        triggerRepo.markFired(db, input.triggerId, input.occurrence)
      }
      if (result.decision === 'deny') {
        return {
          claimed: true,
          result: recordDenial(db, authorization, 'scheduler_trigger', result),
        }
      }
      if (existingApproval?.status === 'delivered' && result.decision !== 'approval_required') {
        return {
          claimed: false,
          result,
          invalidApproval: 'approved scheduler policy or membership changed',
        }
      }
      if (result.decision === 'approval_required') {
        if (existingApproval?.status === 'delivered') {
          const attemptMatches = existingPayload?.message === current.message
          const refsMatch =
            JSON.stringify(result.policyRefs) === JSON.stringify(existingApproval.policyRefs) &&
            JSON.stringify(result.requiredEdgeIds) ===
              JSON.stringify(existingApproval.requiredEdgeIds)
          if (!attemptMatches || !refsMatch) {
            return {
              claimed: false,
              result,
              invalidApproval: !attemptMatches
                ? 'approved scheduler occurrence changed'
                : 'approved scheduler policy or membership changed',
            }
          }
          input.onAllowed?.()
          return { claimed: true, result }
        }
        return {
          claimed: true,
          result,
          approval: { authorization: result, input: authorization, message: current.message },
        }
      }
      input.onAllowed?.()
      return { claimed: true, result }
    },
  )()
  if (outcome.result.decision === 'deny') {
    observeDenial(outcome.result, attempt)
    throw new CommunicationDeniedError(outcome.result, attempt.attemptKind, attempt.attemptId)
  }
  if (outcome.invalidApproval && existingApproval) {
    return {
      kind: 'approval_terminal',
      approval: existingApproval,
      reason: outcome.invalidApproval,
    }
  }
  if (outcome.approval) {
    const approval = communicationApprovalRepo.request(
      db,
      outcome.approval.input,
      'scheduler_trigger',
      outcome.approval.authorization,
      'scheduler_trigger',
      {
        dispatchId: input.dispatchId,
        triggerId: input.triggerId,
        occurrence: input.occurrence,
        agentId: input.agentId,
        message: outcome.approval.message,
      },
      { requester: 'scheduler' },
    )
    if (['pending', 'approved', 'delivering'].includes(approval.status)) {
      return { kind: 'approval_pending', approval }
    }
    if (approval.status === 'delivered') {
      // A concurrent approval completed after our initial read. Defer this
      // provisional claim; the next scheduler pass will validate and execute it.
      return { kind: 'approval_pending', approval }
    }
    return {
      kind: 'approval_terminal',
      approval,
      reason:
        approval.deliveryError ??
        approval.decisionReason ??
        `scheduler approval ${approval.status}`,
    }
  }
  if (outcome.claimed) communicationDecisionMetrics.allowed++
  return outcome.claimed ? { kind: 'claimed' } : { kind: 'already_claimed' }
}

export function claimDeliverableInbox(
  db: BazilionDb,
  agentId: string,
  onAllowed?: () => void,
): Message[] {
  if (!teamPolicyEnforcementEnabled()) {
    const messages = messageRepo.drainUnreadForAgent(db, agentId)
    if (messages.length > 0) onAllowed?.()
    return messages
  }
  const outcome = db.raw.transaction(() => {
    const messages = messageRepo.listInbox(db, agentId, { unreadOnly: true })
    const allowed: Message[] = []
    const denials: Array<{ result: AuthorizationResult; attempt: AuthorizationInput }> = []
    const approvals: Array<{
      result: AuthorizationResult
      attempt: AuthorizationInput
      message: Message
    }> = []
    for (const message of messages) {
      const authorization: AuthorizationInput = {
        source: { kind: 'agent', id: message.fromAgentId },
        target: { kind: 'agent', id: message.toAgentId },
        origin: 'scheduler_inbox',
        attemptKind: 'inbox',
        attemptId: message.id,
      }
      const result = authorizeInSnapshot(db, authorization)
      const granted =
        db.raw
          .query<{ found: number }, [string]>(
            'SELECT 1 found FROM communication_approval_message_grants WHERE message_id = ?',
          )
          .get(message.id) !== null
      if (result.decision === 'allow' || (result.decision === 'approval_required' && granted)) {
        const claimedAt = Date.now()
        messageRepo.markPolicyClaimed(db, message.id, claimedAt)
        allowed.push({ ...message, readAt: claimedAt })
      } else if (result.decision === 'approval_required') {
        approvals.push({ result, attempt: authorization, message })
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
    return { allowed, denials, approvals }
  })()
  for (const pending of outcome.approvals) {
    communicationApprovalRepo.request(
      db,
      pending.attempt,
      'deliver_agent_message',
      pending.result,
      'inbox_message',
      { messageId: pending.message.id },
      { requester: pending.message.fromAgentId },
    )
  }
  communicationDecisionMetrics.allowed += outcome.allowed.length
  for (const denial of outcome.denials) observeDenial(denial.result, denial.attempt)
  return outcome.allowed
}
