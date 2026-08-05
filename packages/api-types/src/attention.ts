export type AttentionKind =
  | 'communication_approval'
  | 'lesson_proposal'
  | 'review_failure'
  | 'trigger_failure'
  | 'agent_loop_break'

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

export interface AttentionAcknowledgementResponse {
  item: AttentionItem
}

export interface AttentionAcknowledgeAllResponse {
  acknowledged: number
}
