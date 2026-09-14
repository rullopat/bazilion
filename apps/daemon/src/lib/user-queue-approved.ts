import type { CommunicationApprovalDetail } from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import { authorizeInSnapshot } from '../core/index.ts'
import * as queue from '../core/repos/user-queue.ts'
import { isAgentTurnActiveError, waitForAgentIdle } from './agent-cancel.ts'
import { prepareAgentTurn, runAgentTurn } from './agent-turn.ts'
import { validateQueuedUserApproval } from './approval-delivery-plan.ts'
import { WorkspaceBusyError } from './coding-environment/workspace.ts'
import { getCtx } from './ctx.ts'
import { protectedFailureMessage } from './protected-failure.ts'
import { requireTelegramQueuedTurn } from './telegram/queue-binding.ts'
import { notifyTelegramQueueStatus } from './telegram/queue-notice.ts'
import { createTrustedTurnInvocation } from './turn-invocation.ts'
import { turnFrameFailure } from './turn-outcome.ts'
import { releasePreparedAgentTurn } from './turn-preparation.ts'

export function queuedApprovalInput(agentId: string, itemId: string) {
  const { db } = getCtx()
  const item = queue.get(db, agentId, itemId)
  return item
    ? { item, inputDigest: queue.approvalReference(db, agentId, itemId).inputDigest }
    : null
}

/** Check before canonical approval claiming so a paused/non-head hold stays pending. */
export function assertQueuedApprovalReady(approval: CommunicationApprovalDetail): void {
  const { db } = getCtx()
  const ref = validateQueuedUserApproval(approval, queuedApprovalInput)
  const head = queue.list(db, ref.agentId, { limit: 1 }).items[0]
  if (queue.control(db, ref.agentId).paused || head?.id !== ref.itemId || head.status !== 'held')
    throw new queue.QueueConflictError('Queued approval is paused or waiting for earlier input')
}

/** Called only by the canonical approval dispatcher after its delivery claim. */
export async function deliverQueuedApproval(approval: CommunicationApprovalDetail): Promise<void> {
  const { db, paths, authToken } = getCtx()
  const ref = validateQueuedUserApproval(approval, queuedApprovalInput)
  db.raw.transaction(() => {
    const owner = db.raw
      .query<{ status: string }, [string]>(
        'SELECT status FROM communication_approvals WHERE id = ?',
      )
      .get(approval.id)
    if (owner?.status !== 'delivering')
      throw new queue.QueueConflictError('Approval is not claimed')
    assertQueuedApprovalReady(approval)
    queue.transition(db, ref.agentId, ref.itemId, 'held', 'claimed')
  })()
  let started = false
  try {
    const input = queue.readInput(db, ref.agentId, ref.itemId)
    const turn = {
      agentId: ref.agentId,
      conversationId: input.item.conversationId,
      message: input.item.text ?? '',
      attachments: input.attachments,
    }
    const telegram =
      input.item.source === 'telegram'
        ? requireTelegramQueuedTurn(db, authToken, input.provenance, turn)
        : null
    for (;;) {
      await waitForAgentIdle(ref.agentId)
      if (queue.control(db, ref.agentId).paused) throw new Error('Queue paused before execution')
      const agent = resolveAgent(db, paths, ref.agentId)
      if (agent.agent.status === 'archived' || agent.team.id !== input.item.teamId)
        throw new Error('Queued Agent membership changed')
      let prepared: Awaited<ReturnType<typeof prepareAgentTurn>>
      try {
        prepared = await prepareAgentTurn({
          invocation: createTrustedTurnInvocation({
            kind: 'approval_delivery',
            authorization: telegram
              ? {
                  origin: 'telegram_agent_topic',
                  attemptKind: 'telegram_ingress',
                  attemptId: approval.attemptId,
                  approvalId: approval.id,
                  agentId: ref.agentId,
                }
              : {
                  origin: 'http_chat',
                  attemptKind: 'http_chat_ingress',
                  attemptId: approval.attemptId,
                  approvalId: approval.id,
                  agentId: ref.agentId,
                },
            turn: {
              agentId: ref.agentId,
              conversationId: input.item.conversationId,
              message: input.item.text ?? '',
              attachments: input.attachments,
            },
            bashApprovalMode: 'auto_deny',
          }),
        })
      } catch (error) {
        if (error instanceof WorkspaceBusyError && !error.recoveryRequired) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          continue
        }
        if (isAgentTurnActiveError(error, ref.agentId)) continue
        throw error
      }
      try {
        if (queue.control(db, ref.agentId).paused) throw new Error('Queue paused before execution')
        const current = authorizeInSnapshot(db, {
          source: approval.source,
          target: approval.target,
          origin: approval.origin,
          attemptKind: approval.attemptKind,
          attemptId: approval.attemptId,
        })
        if (
          current.decision !== 'approval_required' ||
          JSON.stringify(current.policyRefs) !== JSON.stringify(approval.policyRefs) ||
          JSON.stringify(current.requiredEdgeIds) !== JSON.stringify(approval.requiredEdgeIds)
        )
          throw new Error('Queued approval policy changed while waiting')
        if (telegram) requireTelegramQueuedTurn(db, authToken, input.provenance, turn)
        queue.transition(db, ref.agentId, ref.itemId, 'claimed', 'running')
      } catch (error) {
        await releasePreparedAgentTurn(prepared)
        throw error
      }
      started = true
      let failure: string | null = null
      let done = false
      for await (const frame of runAgentTurn(prepared)) {
        failure ??= turnFrameFailure(frame)
        if (frame.kind === 'done') done = true
      }
      const status =
        failure === 'cancelled'
          ? 'cancelled'
          : failure
            ? 'failed'
            : done
              ? 'completed'
              : 'uncertain'
      queue.transition(
        db,
        ref.agentId,
        ref.itemId,
        'running',
        status,
        status === 'completed'
          ? {}
          : { diagnostic: protectedFailureMessage(new Error(failure ?? 'Missing outcome')) },
      )
      if (status !== 'completed') throw new Error('Queued approval turn did not complete')
      return
    }
  } catch (error) {
    const item = queue.get(db, ref.agentId, ref.itemId)
    if (item?.status === 'claimed' || item?.status === 'running')
      queue.transition(db, ref.agentId, ref.itemId, item.status, started ? 'uncertain' : 'failed', {
        diagnostic: protectedFailureMessage(error),
      })
    throw error
  } finally {
    await notifyTelegramQueueStatus(db, ref.agentId, ref.itemId)
  }
}
