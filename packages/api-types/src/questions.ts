/** Clarification data only. None of these choices grant execution or communication permission. */
export interface AgentQuestionInput {
  prompt: string
  choices: Array<{ label: string; description?: string }>
  recommendedIndex?: number
}

export type AgentQuestionAnswer =
  | { kind: 'choice'; index: number }
  | { kind: 'text'; text: string }
  | { kind: 'skip' }

export interface AgentQuestionResponseInput {
  requestId: string
  conversationId: string
  answer: AgentQuestionAnswer
}

export type AgentQuestionStatus = 'pending' | 'answered' | 'skipped' | 'expired' | 'cancelled'
export type AgentQuestionContinuation = 'waiting' | 'unconfirmed' | 'consumed' | 'interrupted'
export type AgentQuestionNoAnswerReason =
  | 'skipped'
  | 'expired'
  | 'cancelled'
  | 'worker_lost'
  | 'daemon_restart'
  | 'restored_backup'
  | 'policy_denied'
  | 'route_unavailable'

export type AgentQuestionToolResult = {
  questionId: string
  question: AgentQuestionInput
  /** Opaque daemon provenance; the adapter saves it in tool details, not model content. */
  receipt?: string
} & (
  | { kind: 'answer'; answer: Exclude<AgentQuestionAnswer, { kind: 'skip' }> }
  | { kind: 'no_answer'; reason: AgentQuestionNoAnswerReason }
)

/** A narrow lifecycle receipt. Pi session JSONL remains the canonical conversation. */
export interface AgentQuestion {
  id: string
  agentId: string
  teamId: string
  conversationId: string
  turnId: string
  toolCallId: string
  question: AgentQuestionInput
  status: AgentQuestionStatus
  revision: number
  createdAt: number
  expiresAt: number
  settledAt: number | null
  deliveredAt: number | null
  answer: AgentQuestionAnswer | null
  responseRequestId: string | null
  noAnswerReason: AgentQuestionNoAnswerReason | null
  continuation: AgentQuestionContinuation
  consumedAt: number | null
  deliveryApprovalId: string | null
  answerApprovalId: string | null
}

export interface AgentQuestionListResponse {
  questions: AgentQuestion[]
}
export interface AgentQuestionResponse {
  kind: 'accepted' | 'already_applied' | 'conflict' | 'held'
  question: AgentQuestion
}
