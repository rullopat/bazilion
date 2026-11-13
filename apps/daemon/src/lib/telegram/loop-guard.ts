// Per-agent budget for verbose mirror lines (tool calls and results), so an Agent working through
// a long scheduled task cannot flood its topic. The agent's replies and failures are never
// counted or dropped. Messages from other bots never reach an agent: routing drops them.

const MAX_LINES = 30
const WINDOW_MS = 60_000

const _outbound = new Map<string, number[]>()

/** True when one more verbose line for this agent fits in the sliding window. */
export function allowTelegramOutboundNoise(agentId: string): boolean {
  const now = Date.now()
  const hits = (_outbound.get(agentId) ?? []).filter((at) => now - at < WINDOW_MS)
  const allowed = hits.length < MAX_LINES
  if (allowed) hits.push(now)
  _outbound.set(agentId, hits)
  return allowed
}

/** Test-only. */
export function _resetLoopGuardForTest(): void {
  _outbound.clear()
}
