import { isActiveAgent } from './agent-cancel.ts'

const LEASES_KEY = Symbol.for('bazilion.agent-lifecycle.leases')

interface Waiter {
  resolve: (release: () => void) => void
}

interface LeaseState {
  held: Set<string>
  waiters: Map<string, Waiter[]>
}

function state(): LeaseState {
  const global = globalThis as unknown as Record<symbol, LeaseState | undefined>
  let value = global[LEASES_KEY]
  if (!value) {
    value = { held: new Set(), waiters: new Map() }
    global[LEASES_KEY] = value
  }
  return value
}

export function acquireAgentLifecycleLease(agentId: string): Promise<() => void> {
  const leases = state()
  if (!leases.held.has(agentId)) {
    leases.held.add(agentId)
    return Promise.resolve(makeRelease(agentId))
  }
  return new Promise((resolve) => {
    const queue = leases.waiters.get(agentId) ?? []
    queue.push({ resolve })
    leases.waiters.set(agentId, queue)
  })
}

function makeRelease(agentId: string): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    const leases = state()
    const queue = leases.waiters.get(agentId)
    const next = queue?.shift()
    if (next) {
      if (queue?.length === 0) leases.waiters.delete(agentId)
      next.resolve(makeRelease(agentId))
      return
    }
    leases.held.delete(agentId)
  }
}

export async function runAgentLifecycleMutation<T>(
  agentId: string,
  mutation: () => T | Promise<T>,
): Promise<T> {
  const release = await acquireAgentLifecycleLease(agentId)
  try {
    if (isActiveAgent(agentId)) {
      throw new Error(`agent_turn_active: ${agentId}`)
    }
    return await mutation()
  } finally {
    release()
  }
}
