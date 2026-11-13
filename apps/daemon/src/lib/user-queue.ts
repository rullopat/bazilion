import type { Attachment, UserQueueItem } from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import type { BazilionDb } from '../core/db/client.ts'
import * as queue from '../core/repos/user-queue.ts'
import {
  cancelAgent,
  isActiveAgent,
  isAgentTurnActiveError,
  isShuttingDownError,
} from './agent-cancel.ts'
import { prepareAgentTurn, runAgentTurn } from './agent-turn.ts'
import { resolveConversationTarget } from './conversation-target.ts'
import { getCtx } from './ctx.ts'
import {
  isTelegramSenderAllowed,
  type TelegramOrigin,
  telegramAttemptId,
} from './telegram/origin.ts'
import { notifyTelegramQueueOutcome } from './telegram/queue-notice.ts'
import { turnFailureReason, turnFrameFailure } from './turn-outcome.ts'

// The follow-up queue in the daemon: input queued while an Agent is busy runs afterwards as its
// own turn, oldest first, in the conversation it was sent to. A pump starts the next item when
// the Agent is free.

/** Queue input for the Agent's selected conversation. A Telegram message is queued once. */
export async function enqueueUserInput(
  agentId: string,
  input: { message: string; attachments: Attachment[]; telegram?: TelegramOrigin },
  context: Pick<ReturnType<typeof getCtx>, 'db' | 'paths'> = getCtx(),
): Promise<UserQueueItem> {
  const { db, paths } = context
  queue.validateInput(input.message, input.attachments)
  if (resolveAgent(db, paths, agentId).agent.status === 'archived')
    throw new queue.QueueConflictError('The Agent is archived')
  return queue.add(db, {
    agentId,
    conversationId: resolveConversationTarget(db, paths, agentId).id,
    message: input.message,
    attachments: input.attachments,
    ...(input.telegram
      ? { telegram: { key: telegramAttemptId(input.telegram), origin: input.telegram } }
      : {}),
  })
}

/**
 * Stop: cancel the running turn. When follow-ups are waiting, also pause the queue, so they do
 * not start the moment the turn ends; Resume starts them again.
 */
export function stopAgentTurn(
  db: BazilionDb,
  agentId: string,
): { cancelled: boolean; queuePaused: boolean } {
  const queuePaused = queue.pendingCount(db, agentId) > 0
  if (queuePaused) queue.setPaused(db, agentId, true)
  return { cancelled: cancelAgent(agentId), queuePaused }
}

/** Run the Agent's next waiting item. False when nothing ran (busy, paused or empty). */
export async function drainUserQueueHead(agentId: string): Promise<boolean> {
  const { db } = getCtx()
  if (isActiveAgent(agentId)) return false
  const claimed = queue.claim(db, agentId)
  if (!claimed) return false
  const { item, attachments } = claimed
  const origin = claimed.origin as TelegramOrigin | null
  const finish = async (
    status: 'completed' | 'failed' | 'cancelled',
    diagnostic: string | null = null,
  ) => {
    const finished = queue.finish(db, agentId, item.id, status, diagnostic)
    if (finished && status !== 'completed')
      await notifyTelegramQueueOutcome(finished, origin, status)
  }
  // Removing someone from the Telegram allowlist also drops what they queued.
  if (origin && !isTelegramSenderAllowed(db, origin.userId)) {
    await finish('cancelled', 'The sender is no longer allowed')
    return true
  }
  // A Telegram item runs as a Telegram turn (it can ask in its topic); any other as an HTTP one
  // that nobody is watching.
  const turn = {
    attemptId: item.id,
    agentId,
    conversationId: item.conversationId,
    message: item.text,
    attachments,
  }
  let prepared: Awaited<ReturnType<typeof prepareAgentTurn>>
  try {
    prepared = await prepareAgentTurn(
      origin
        ? { ...turn, origin: 'telegram' }
        : { ...turn, origin: 'http', bashApprovalMode: 'auto_deny' },
    )
  } catch (error) {
    // Another turn started first, or the daemon is stopping: the item stays at the head of the
    // queue.
    if (isAgentTurnActiveError(error, agentId) || isShuttingDownError(error)) {
      queue.unclaim(db, item.id)
      return false
    }
    await finish('failed', turnFailureReason(error))
    return true
  }
  let failure: string | null = null
  let done = false
  try {
    for await (const frame of runAgentTurn(prepared)) {
      failure ??= turnFrameFailure(frame)
      if (frame.kind === 'done') done = true
    }
  } catch (error) {
    failure ??= turnFailureReason(error)
  }
  // The conversation holds the turn's full error; the item keeps the reason on one line. Stop
  // pressed before the worker started surfaces as an AbortError, not as 'cancelled'.
  if (failure === 'cancelled' || prepared.controller.signal.aborted)
    await finish('cancelled', turnFailureReason('cancelled'))
  else if (failure) await finish('failed', turnFailureReason(failure))
  else if (!done) await finish('failed', 'The turn ended without a reply.')
  else await finish('completed')
  return true
}

/** Start the next waiting item of every Agent that is free, once a second. */
export function startUserQueuePump(): { stop: () => Promise<void> } {
  const { db } = getCtx()
  const active = new Map<string, Promise<void>>()
  let stopping = false
  let lastPruned = 0
  const tick = () => {
    if (stopping) return
    try {
      if (Date.now() - lastPruned >= 60 * 60_000) {
        queue.prune(db)
        lastPruned = Date.now()
      }
      for (const agentId of queue.agentsWithPending(db)) {
        if (active.has(agentId)) continue
        const work = drainUserQueueHead(agentId)
          .then(() => {})
          .catch((error) => {
            console.error(`Follow-up queue of ${agentId} failed: ${(error as Error).message}`)
          })
          .finally(() => {
            active.delete(agentId)
          })
        active.set(agentId, work)
      }
    } catch (error) {
      console.error(`Follow-up queue check failed: ${(error as Error).message}`)
    }
  }
  const timer = setInterval(tick, 1_000)
  timer.unref()
  return {
    async stop() {
      stopping = true
      clearInterval(timer)
      for (const agentId of active.keys()) cancelAgent(agentId)
      await Promise.allSettled(active.values())
    },
  }
}
