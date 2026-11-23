import type {
  AgentLessonProposal,
  AgentLessonScope,
  AgentReview,
  ReasoningLevel,
} from './entities.ts'

export interface SpawnAgentRequest {
  profileId: string
  name?: string
  model?: string
  reasoningLevel?: ReasoningLevel
  /** Team the new agent joins; defaults to `default`. */
  teamId?: string
  /**
   * What it is for: written at the top of its AGENTS.md, so it starts knowing its job, without the
   * get-to-know questions of a first conversation. Empty: it asks them.
   */
  role?: string
}

/** Body for `PATCH /api/agents/:id/team`: move the agent to a new team. */
export interface MoveAgentRequest {
  teamId: string
}

// --- reviewed learning ---

export interface AgentReviewConfig {
  enabled: boolean
  everyNTurns: number
  model: string | null
  reasoningLevel: ReasoningLevel
  turnsSinceLast: number
}

export interface UpdateAgentReviewConfigRequest {
  enabled?: boolean
  everyNTurns?: number
  model?: string | null
  reasoningLevel?: ReasoningLevel
}

export interface EnqueueAgentReviewResponse {
  review: AgentReview
}

export interface ListAgentReviewsResponse {
  reviews: AgentReview[]
}

export interface ListAgentLessonProposalsResponse {
  proposals: AgentLessonProposal[]
}

export interface UpdateAgentLessonProposalRequest {
  version: number
  text?: string
  scope?: AgentLessonScope
}

export interface DecideAgentLessonProposalRequest {
  version: number
}

export interface AgentLessonProposalResponse {
  proposal: AgentLessonProposal
}
