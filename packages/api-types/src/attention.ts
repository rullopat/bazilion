/** What the daemon keeps a record of until it is dealt with. Telegram can notify about these. */
export type AttentionRecordedKind =
  | 'trigger_failure'
  | 'agent_loop_break'
  | 'queue_interrupted'
  | 'turn_failure'

/** An Agent waiting on the operator right now: it lasts while the Agent's turn waits. */
export type AttentionWaitingKind = 'agent_question' | 'command_approval'

export type AttentionKind = AttentionWaitingKind | AttentionRecordedKind

export type AttentionSeverity = 'action_required' | 'error' | 'warning'
export type AttentionState = 'open' | 'acknowledged' | 'all'

export interface AttentionItem {
  key: string
  kind: AttentionKind
  severity: AttentionSeverity
  sourceId: string
  occurredAt: number
  updatedAt: number
  agentId?: string
  agentName?: string
  teamId?: string
  teamName?: string
  title: string
  diagnostic: string
  href: string
  acknowledgeable: boolean
  acknowledgedAt: number | null
  /** When a waiting item stops waiting: the question expires or the command is refused. */
  expiresAt?: number
}

export interface AttentionDegradedSource {
  kind: AttentionKind
  error: string
}

export interface AttentionListResponse {
  items: AttentionItem[]
  degraded: AttentionDegradedSource[]
}

export interface AttentionSummary {
  openTotal: number
  bySeverity: Record<AttentionSeverity, number>
  byKind: Record<AttentionKind, number>
  degraded: AttentionDegradedSource[]
}
