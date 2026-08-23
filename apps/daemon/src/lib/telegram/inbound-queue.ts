// Per-agent inbound message queue.
//
// Concurrent runAgentTurn calls on the same agent are unsafe (shared worker
// state, session JSONL). When a Telegram user types in a bound topic while
// the agent is mid-turn, we can't just spawn a parallel worker. Earlier
// versions of Step 6 dropped the second message silently — which lost the
// content and gave the user no signal.
//
// The fix: a per-agent FIFO queue + a single drain loop. Every Telegram
// update remains one exact authorization attempt and one Agent turn. Items
// are never concatenated under the first update's attempt identity.
//
// Failures inside runAgentTurn are caught + logged; the loop continues so
// later queue items still get a chance. Unbounded growth isn't a real
// concern in practice (a human can only type so fast), so we don't cap.

import type { Attachment } from '@bazilion/api-types'
import { isActiveAgent, isAgentTurnActiveError, waitForAgentIdle } from '../agent-cancel.ts'
import { prepareAgentTurn, runAgentTurn } from '../agent-turn.ts'
import { CommunicationDeniedError, CommunicationPendingError } from '../communication.ts'
import { createTrustedTurnInvocation, type TrustedTurnInvocation } from '../turn-invocation.ts'
import { isTelegramIngressAttempt, type TelegramIngressAttempt } from './ingress-attempt.ts'

export type TelegramIngressNotifier = (text: string) => Promise<void>

interface QueueItem {
  invocation: Extract<TrustedTurnInvocation, { kind: 'telegram' }>
  notify: TelegramIngressNotifier
}

const _queues = new Map<string, QueueItem[]>()
const _running = new Map<string, Promise<void>>()

/**
 * Append a message (text + optional images) to the agent's inbound queue and
 * ensure the drain loop is running. Safe to call from anywhere — the routing
 * layer calls it for every message in a bound agent topic.
 */
export function enqueueAgentMessage(
  agentId: string,
  text: string,
  attachments: Attachment[],
  authorization: TelegramIngressAttempt,
  notify: TelegramIngressNotifier,
): void {
  if (!isTelegramIngressAttempt(authorization, agentId)) {
    throw new Error('telegram_ingress_invalid: authorization does not match queue item')
  }
  const q = _queues.get(agentId) ?? []
  const invocation = createTrustedTurnInvocation({
    kind: 'telegram',
    authorization,
    turn: { agentId, message: text, attachments },
    bashApprovalMode: 'auto_deny',
  }) as Extract<TrustedTurnInvocation, { kind: 'telegram' }>
  q.push({ invocation, notify })
  _queues.set(agentId, q)
  ensureDrainStarted(agentId)
}

/** Peek queue length — used by tests + future telemetry. */
export function pendingMessageCount(agentId: string): number {
  return _queues.get(agentId)?.length ?? 0
}

/** True iff there's a drain loop currently running for this agent. */
export function isDraining(agentId: string): boolean {
  return _running.has(agentId)
}

function ensureDrainStarted(agentId: string): void {
  if (_running.has(agentId)) return
  const promise = drainLoop(agentId).finally(() => {
    _running.delete(agentId)
    // Defensive: if a message landed in the tiny window between the loop
    // returning and this cleanup, kick off another loop. The loop itself
    // already re-checks before exit, so this almost never fires.
    if ((_queues.get(agentId)?.length ?? 0) > 0) ensureDrainStarted(agentId)
  })
  _running.set(agentId, promise)
}

async function drainLoop(agentId: string): Promise<void> {
  while (true) {
    const q = _queues.get(agentId)
    if (!q || q.length === 0) return
    const item = q[0]
    if (!item) return

    // A web, scheduler, inbox, approval, or review turn may already own the
    // Agent even though this Telegram queue has only one drain of its own.
    // Keep the exact FIFO head in place and sleep on the registry transition;
    // polling or immediately restarting the drain would hot-loop.
    if (isActiveAgent(agentId)) {
      await waitForAgentIdle(agentId)
      continue
    }

    let preparedTurn: Awaited<ReturnType<typeof prepareAgentTurn>>
    try {
      preparedTurn = await prepareAgentTurn({
        invocation: item.invocation,
      })
    } catch (error) {
      if (isAgentTurnActiveError(error, agentId)) {
        await waitForAgentIdle(agentId)
        continue
      }
      removeHead(agentId, q, item)
      await reportTurnFailure(agentId, item, error)
      continue
    }

    try {
      for await (const _frame of runAgentTurn(preparedTurn)) {
        // Mirror handles the assistant's reply via the runAgentTurn frame
        // hook; we just need to drain the iterator so the worker doesn't
        // back up.
        void _frame
      }
    } catch (error) {
      removeHead(agentId, q, item)
      await reportTurnFailure(agentId, item, error)
      continue
    }
    removeHead(agentId, q, item)
  }
}

function removeHead(agentId: string, q: QueueItem[], item: QueueItem): void {
  if (q[0] !== item) throw new Error('telegram inbound FIFO head changed during drain')
  q.shift()
  if (q.length === 0) _queues.delete(agentId)
}

async function reportTurnFailure(agentId: string, item: QueueItem, error: unknown): Promise<void> {
  await notifyTurnFailure(item, error)
  console.warn(
    JSON.stringify({
      event: 'telegram_inbound_turn_failed',
      agentId,
      attemptKind: item.invocation.authorization.attemptKind,
      attemptId: item.invocation.authorization.attemptId,
      errorName: error instanceof Error ? error.name : 'unknown',
      failure:
        error instanceof CommunicationPendingError
          ? 'approval_pending'
          : error instanceof CommunicationDeniedError
            ? 'policy_denied'
            : 'turn_unavailable',
    }),
  )
}

async function notifyTurnFailure(item: QueueItem, error: unknown): Promise<void> {
  const text =
    error instanceof CommunicationPendingError
      ? `Communication is pending approval (${error.approval.id}).`
      : error instanceof CommunicationDeniedError
        ? `Communication blocked by Team policy (${error.result.reasonCode}).`
        : 'This protected turn could not start. Check Bazilion Config or bazilion doctor.'
  try {
    await item.notify(text)
  } catch {
    // The policy decision / turn failure remains authoritative if Telegram is unavailable.
  }
}

/** Test-only — wipe the queue + running maps. */
export function _resetInboundQueueForTest(): void {
  _queues.clear()
  _running.clear()
}
