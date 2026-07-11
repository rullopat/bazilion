// In-memory registry of agents currently running a turn and their
// AbortControllers. The chat / scheduler / inbox-wake paths register before
// they spawn a worker; the cancel route looks the agent up and calls
// `abort()`. Doubles as the "is this agent busy?" probe the scheduler uses
// to skip overlapping inbox-wakes and triggers.
//
// Pinned to `globalThis` via a well-known Symbol so there is exactly one
// instance per process even if a bundler ever splits this module across
// chunks. Two different Map instances would make registrations invisible to
// the cancel side.

const REGISTRY_KEY = Symbol.for('bazilion.agent-cancel.registry')

interface Registry {
  active: Map<string, AbortController>
}

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  let r = g[REGISTRY_KEY]
  if (!r) {
    r = { active: new Map() }
    g[REGISTRY_KEY] = r
  }
  return r
}

export function registerAgent(agentId: string, controller: AbortController): void {
  if (registry().active.has(agentId)) {
    throw new Error(`agent_turn_active: ${agentId}`)
  }
  registry().active.set(agentId, controller)
}

export function unregisterAgent(agentId: string): void {
  registry().active.delete(agentId)
}

/** Returns true if the agent had an active turn that was aborted, false otherwise. */
export function cancelAgent(agentId: string): boolean {
  const { active } = registry()
  const c = active.get(agentId)
  if (!c) return false
  c.abort()
  // Keep the registration until runAgentTurn's finally block settles. A
  // lifecycle mutation after cancel must not race the still-unwinding worker.
  return true
}

export function isActiveAgent(agentId: string): boolean {
  return registry().active.has(agentId)
}
