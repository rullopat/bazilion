import { randomUUID } from 'node:crypto'
import type { Attachment, EnqueueUserInput, UserQueueItem } from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import * as conversations from '../core/repos/conversations.ts'
import * as queue from '../core/repos/user-queue.ts'
import { recordDenial } from '../core/team-policy/authorization.ts'
import { acquireAgentLifecycleLease } from './agent-lifecycle-lease.ts'
import {
  authorizeUserIngress,
  CommunicationDeniedError,
  CommunicationPendingError,
} from './communication.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { getCtx } from './ctx.ts'
import { requireTelegramQueuedTurn, type TelegramQueueBinding } from './telegram/queue-binding.ts'

/** Routing captures authority before download; admission rechecks it before persisting bytes. */
export async function enqueueTelegramInput(
  binding: TelegramQueueBinding,
  message: string,
  attachments: Attachment[],
  context = getCtx(),
): Promise<UserQueueItem> {
  queue.validateInput(message, attachments)
  const { db, paths, authToken } = context
  const { agentId, conversationId } = binding.authorization.approvalPayload
  const release = await acquireAgentLifecycleLease(agentId)
  let teamId: string | undefined
  try {
    requireTelegramQueuedTurn(db, authToken, binding, {
      agentId,
      conversationId,
      message,
      attachments,
    })
    const agent = resolveAgent(db, paths, agentId)
    teamId = agent.team.id
    const existing = queue.findAttempt(db, 'telegram', binding.authorization.attemptId)
    return db.raw.transaction(() => {
      const item = queue.accept(db, {
        id: existing?.id ?? randomUUID(),
        agentId,
        teamId: existing?.teamId ?? agent.team.id,
        conversationId,
        source: 'telegram',
        attemptId: binding.authorization.attemptId,
        provenance: binding,
        message,
        attachments,
      })
      if (existing) return item
      try {
        authorizeUserIngress(db, agentId, {
          ...binding.authorization,
          approvalPayloadKind: 'queued_user',
          approvalPayload: queue.approvalReference(db, agentId, item.id),
        })
      } catch (error) {
        if (!(error instanceof CommunicationPendingError)) throw error
        return queue.transition(db, agentId, item.id, 'pending', 'held', {
          approvalId: error.approval.id,
        })
      }
      return item
    })()
  } catch (error) {
    if (error instanceof CommunicationDeniedError && teamId) {
      recordDenial(
        db,
        {
          source: { kind: 'user', teamId },
          target: { kind: 'agent', id: agentId },
          origin: binding.authorization.origin,
          attemptKind: binding.authorization.attemptKind,
          attemptId: binding.authorization.attemptId,
        },
        'user_to_agent',
        error.result,
      )
    }
    throw error
  } finally {
    release()
  }
}

/** Authenticated operator entry. Persistence and any canonical approval hold commit together. */
export async function enqueueHttpInput(
  agentId: string,
  input: EnqueueUserInput,
  replacement?: { id: string; expectedRevision: number },
): Promise<UserQueueItem> {
  if (
    !input ||
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
  )
    throw new Error('Invalid queue request ID')
  queue.validateInput(input.message, input.attachments ?? [])
  const { db, paths } = getCtx()
  const release = await acquireAgentLifecycleLease(agentId)
  let requestedTeamId: string | undefined
  try {
    const existing = queue.findAttempt(db, 'http', input.requestId)
    if (existing && existing.agentId !== agentId)
      throw new queue.QueueConflictError('Queue request belongs to another Agent')
    const agent = resolveAgent(db, paths, agentId)
    requestedTeamId = agent.team.id
    // An exact retry is a read, including after membership/selection changes or terminal pruning.
    if (!existing) {
      if (agent.agent.status === 'archived') throw new queue.QueueConflictError('Agent is archived')
      conversations.assertSelection(db, agentId, input.expectedSelection)
    }
    const conversationId =
      existing?.conversationId ?? resolveConversationTarget(db, paths, agentId).id
    const request: queue.QueueInput = {
      id: input.requestId,
      agentId,
      teamId: existing?.teamId ?? agent.team.id,
      conversationId,
      source: 'http',
      attemptId: input.requestId,
      provenance: { requester: 'user', expectedSelection: input.expectedSelection },
      message: input.message,
      attachments: input.attachments ?? [],
    }
    return db.raw.transaction(() => {
      const item = queue.accept(db, request, replacement)
      if (existing) return item
      try {
        authorizeUserIngress(db, agentId, {
          origin: 'http_chat',
          attemptKind: 'http_chat_ingress',
          attemptId: item.attemptId,
          requester: 'user',
          approvalPayloadKind: 'queued_user',
          approvalPayload: queue.approvalReference(db, agentId, item.id),
        })
      } catch (error) {
        if (!(error instanceof CommunicationPendingError)) throw error
        return queue.transition(db, agentId, item.id, 'pending', 'held', {
          approvalId: error.approval.id,
        })
      }
      return item
    })()
  } catch (error) {
    // The input transaction rolls back on denial; preserve the source-owned block evidence.
    if (error instanceof CommunicationDeniedError && requestedTeamId) {
      recordDenial(
        db,
        {
          source: { kind: 'user', teamId: requestedTeamId },
          target: { kind: 'agent', id: agentId },
          origin: 'http_chat',
          attemptKind: 'http_chat_ingress',
          attemptId: input.requestId,
        },
        'user_to_agent',
        error.result,
      )
    }
    throw error
  } finally {
    release()
  }
}
