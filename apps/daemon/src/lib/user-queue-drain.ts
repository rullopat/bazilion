import * as queue from '../core/repos/user-queue.ts'
import { isActiveAgent, isAgentTurnActiveError } from './agent-cancel.ts'
import { prepareAgentTurn, runAgentTurn } from './agent-turn.ts'
import { WorkspaceBusyError } from './coding-environment/workspace.ts'
import { CommunicationPendingError } from './communication.ts'
import { getCtx } from './ctx.ts'
import { protectedFailureMessage } from './protected-failure.ts'
import { requireTelegramQueuedTurn } from './telegram/queue-binding.ts'
import { notifyTelegramQueueStatus } from './telegram/queue-notice.ts'
import { createTrustedTurnInvocation } from './turn-invocation.ts'
import { turnFrameFailure } from './turn-outcome.ts'
import { releasePreparedAgentTurn } from './turn-preparation.ts'

/** One durable FIFO claim; the existing preparation path still owns Agent admission. */
export async function drainUserQueueHead(agentId: string): Promise<boolean> {
  const { db, authToken } = getCtx()
  if (isActiveAgent(agentId)) return false
  const item = queue.claim(db, agentId)
  if (!item) return false
  let started = false
  try {
    const input = queue.readInput(db, agentId, item.id)
    const turn = {
      agentId,
      conversationId: item.conversationId,
      message: input.item.text ?? '',
      attachments: input.attachments,
    }
    const telegram =
      item.source === 'telegram'
        ? requireTelegramQueuedTurn(db, authToken, input.provenance, turn)
        : null
    const prepared = await prepareAgentTurn({
      queuedItemId: item.id,
      invocation: createTrustedTurnInvocation(
        telegram
          ? {
              kind: 'telegram',
              authorization: telegram.authorization,
              turn,
              bashApprovalMode: 'auto_deny',
            }
          : {
              kind: 'operator_http',
              authorization: {
                origin: 'http_chat',
                attemptKind: 'http_chat_ingress',
                attemptId: item.attemptId,
                requester: 'user',
                agentId,
              },
              turn: {
                agentId,
                conversationId: item.conversationId,
                message: input.item.text ?? '',
                attachments: input.attachments,
              },
              bashApprovalMode: 'auto_deny',
            },
      ),
    })
    try {
      if (queue.control(db, agentId).paused) {
        queue.transition(db, agentId, item.id, 'claimed', 'pending')
        await releasePreparedAgentTurn(prepared)
        return false
      }
      if (telegram) requireTelegramQueuedTurn(db, authToken, input.provenance, turn)
      queue.transition(db, agentId, item.id, 'claimed', 'running')
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
      failure === 'cancelled' ? 'cancelled' : failure ? 'failed' : done ? 'completed' : 'uncertain'
    queue.transition(
      db,
      agentId,
      item.id,
      'running',
      status,
      status === 'completed'
        ? {}
        : { diagnostic: protectedFailureMessage(new Error(failure ?? 'Missing outcome')) },
    )
    return true
  } catch (error) {
    if (
      !started &&
      (isAgentTurnActiveError(error, agentId) || error instanceof WorkspaceBusyError)
    ) {
      queue.transition(db, agentId, item.id, 'claimed', 'pending')
      return false
    }
    if (!started && error instanceof CommunicationPendingError) {
      queue.transition(db, agentId, item.id, 'claimed', 'held', { approvalId: error.approval.id })
      return false
    }
    const current = queue.get(db, agentId, item.id)
    if (current?.status === 'claimed' || current?.status === 'running')
      queue.transition(db, agentId, item.id, current.status, started ? 'uncertain' : 'failed', {
        diagnostic: protectedFailureMessage(error),
      })
    return true
  } finally {
    await notifyTelegramQueueStatus(db, agentId, item.id)
  }
}
