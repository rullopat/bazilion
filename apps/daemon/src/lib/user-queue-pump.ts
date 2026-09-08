import * as queue from '../core/repos/user-queue.ts'
import { cancelAgent } from './agent-cancel.ts'
import { getCtx } from './ctx.ts'
import { drainUserQueueHead } from './user-queue-drain.ts'

/** Independent from scheduled triggers. SQLite owns claims; this map only bounds local tasks. */
export function startUserQueuePump(): { stop: () => Promise<void> } {
  const { db } = getCtx()
  const active = new Map<string, Promise<void>>()
  let stopping = false
  let lastPruned = 0
  const tick = () => {
    if (stopping) return
    try {
      queue.reconcileApprovalHolds(db)
      if (Date.now() - lastPruned >= 60_000) {
        queue.pruneTerminalInput(db)
        lastPruned = Date.now()
      }
      for (const agentId of queue.agentsWithOpenItems(db)) {
        if (active.has(agentId)) continue
        const work = drainUserQueueHead(agentId)
          .then(() => {})
          .catch(() => {
            console.error('Queue dispatch failed; inspect the retained queue outcome.')
          })
          .finally(() => {
            active.delete(agentId)
          })
        active.set(agentId, work)
      }
    } catch {
      console.error('Queue maintenance failed; retained input will be checked on the next tick.')
    }
  }
  const timer = setInterval(tick, 1_000)
  timer.unref()
  return {
    async stop() {
      stopping = true
      clearInterval(timer)
      for (const agentId of active.keys()) {
        const head = queue.list(db, agentId, { limit: 1 }).items[0]
        if (head?.status === 'running') cancelAgent(agentId)
      }
      await Promise.allSettled(active.values())
    },
  }
}
