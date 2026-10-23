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
  idleWaiters: Map<string, Set<() => void>>
  stopping?: boolean
  stopped?: Promise<void>
}

export class AgentTurnActiveError extends Error {
  readonly code = 'agent_turn_active'

  constructor(readonly agentId: string) {
    super(`agent_turn_active: ${agentId}`)
    this.name = 'AgentTurnActiveError'
  }
}

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  let r = g[REGISTRY_KEY]
  if (!r) {
    r = { active: new Map(), idleWaiters: new Map() }
    g[REGISTRY_KEY] = r
  } else if (!r.idleWaiters) {
    // Keep the global singleton compatible with a module reloaded in-place by
    // the dev server or test runner.
    r.idleWaiters = new Map()
  }
  return r
}

export function registerAgent(agentId: string, controller: AbortController): void {
  if (registry().stopping) throw new Error('daemon_shutting_down')
  if (registry().active.has(agentId)) {
    throw new AgentTurnActiveError(agentId)
  }
  registry().active.set(agentId, controller)
}

export function unregisterAgent(agentId: string): void {
  const state = registry()
  if (!state.active.delete(agentId)) return
  const waiters = state.idleWaiters.get(agentId)
  state.idleWaiters.delete(agentId)
  for (const resolve of waiters ?? []) resolve()
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

/** A live question belongs to this registration, not a later turn using the same Agent. */
export function ownsActiveAgent(agentId: string, controller: AbortController): boolean {
  return registry().active.get(agentId) === controller
}

/** Fence new admissions and settle every registered turn before daemon-owned resources/DB close. */
export function stopAgentTurns(): Promise<void> {
  const state = registry()
  if (state.stopped) return state.stopped
  state.stopping = true
  const active = [...state.active]
  // Install waiters before abort: a synchronous abort handler may release its registration.
  state.stopped = Promise.all(active.map(([agentId]) => waitForAgentIdle(agentId))).then(() => {})
  for (const [, controller] of active) controller.abort()
  return state.stopped
}

/** Resolve when an existing cross-source turn releases this Agent. */
export function waitForAgentIdle(agentId: string): Promise<void> {
  const state = registry()
  if (!state.active.has(agentId)) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = state.idleWaiters.get(agentId) ?? new Set()
    waiters.add(resolve)
    state.idleWaiters.set(agentId, waiters)
  })
}

export function isAgentTurnActiveError(error: unknown, agentId: string): boolean {
  return error instanceof AgentTurnActiveError && error.agentId === agentId
}
