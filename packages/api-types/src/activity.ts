// Wire shapes of the activity feed (`GET /api/activity`): what every Agent is doing right now
// and what it has produced, in one response the workspace polls.

/** The latest tool call of a running turn. */
export interface ActivityStep {
  /** Tool name, e.g. `write`, `bash`, `browser_navigate`. */
  tool: string
  /** What the call works on (a path, a command, a URL, a recipient Agent id); null when unknown. */
  target: string | null
}

export interface AgentActivity {
  agentId: string
  teamId: string
  /** A turn is running: a chat, a follow-up, Telegram, a schedule or an inbox wake. */
  working: boolean
  /** The running turn's latest tool call; null while idle or before the first call. */
  step: ActivityStep | null
  /** Questions (`ask_user`) waiting for the operator. */
  questions: number
  /** Shell commands waiting for approval. */
  approvals: number
  /** Follow-ups are waiting behind a paused queue. */
  queuePaused: boolean
  /** When the selected conversation last changed (epoch ms); null before the first turn. */
  lastActivityAt: number | null
  /** Saved results of this Agent. */
  results: number
  /** When its newest result was saved (epoch ms); null when it has none. */
  lastResultAt: number | null
}

export interface ActivityResponse {
  agents: AgentActivity[]
}
