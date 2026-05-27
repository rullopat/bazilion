// Per-agent inbound message queue.
//
// Concurrent runAgentTurn calls on the same agent are unsafe (shared worker
// state, session JSONL). When a Telegram user types in a bound topic while
// the agent is mid-turn, we can't just spawn a parallel worker. Earlier
// versions of Step 6 dropped the second message silently — which lost the
// content and gave the user no signal.
//
// The fix: a per-agent FIFO queue + a single drain loop. enqueueAgentMessage
// always succeeds; the loop reads, concatenates, runs runAgentTurn, then
// re-checks the queue. At most one loop per agent exists at any time. If
// the user types three messages in rapid succession during a long turn,
// the next turn input is `msg2\n\nmsg3\n\nmsg4` — the agent sees all of
// them and can address them in one combined reply.
//
// Failures inside runAgentTurn are caught + logged; the loop continues so
// later queue items still get a chance. Unbounded growth isn't a real
// concern in practice (a human can only type so fast), so we don't cap.

import { runAgentTurn } from '../agent-turn.ts'

const _queues = new Map<string, string[]>()
const _running = new Map<string, Promise<void>>()

/**
 * Append `text` to the agent's inbound queue and ensure the drain loop is
 * running. Safe to call from anywhere — the routing layer calls it for
 * every plain-text message in a bound agent topic.
 */
export function enqueueAgentMessage(agentId: string, text: string): void {
  const q = _queues.get(agentId) ?? []
  q.push(text)
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
    const message = q.join('\n\n')
    _queues.set(agentId, [])
    try {
      for await (const _frame of runAgentTurn(agentId, message)) {
        // Mirror handles the assistant's reply via the runAgentTurn frame
        // hook; we just need to drain the iterator so the worker doesn't
        // back up.
        void _frame
      }
    } catch (e) {
      console.warn(
        `telegram inbound-queue: turn for agent=${agentId} failed —`,
        e instanceof Error ? e.message : String(e),
      )
      // Loop continues so newly-queued messages still get a chance.
    }
  }
}

/** Test-only — wipe the queue + running maps. */
export function _resetInboundQueueForTest(): void {
  _queues.clear()
  _running.clear()
}
