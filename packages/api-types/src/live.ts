// GET /api/events: a server-sent event stream that pushes what the web UI shows live, when it
// changes, instead of being asked every few seconds. Each event's `data` is one of these, as JSON;
// the SSE event name is its `type`. The first two events after connecting are the current state.

import type { AgentActivity } from './activity.ts'
import type { AttentionItem, AttentionSummary } from './attention.ts'

/** What every Agent is doing, as GET /api/activity answers. */
export interface LiveActivityEvent {
  type: 'activity'
  agents: AgentActivity[]
  /** As `ActivityResponse.roster`. */
  roster: string
}

/** What is open in Attention. */
export interface LiveAttentionEvent {
  type: 'attention'
  summary: AttentionSummary
  /** Changes whenever any item is added, updated, acknowledged or goes away. */
  revision: string
  /** The questions and commands Agents wait on now, the one that expires soonest first. */
  waiting: AttentionItem[]
}

export type LiveEvent = LiveActivityEvent | LiveAttentionEvent
