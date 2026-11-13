/** What an Agent asks with `ask_user`. Answers are information only and grant no permission. */
export interface AgentQuestionInput {
  prompt: string
  choices: Array<{ label: string; description?: string }>
  recommendedIndex?: number
}

export type AgentQuestionAnswer =
  | { kind: 'choice'; index: number }
  | { kind: 'text'; text: string }
  | { kind: 'skip' }

/** What `ask_user` returns to the model. */
export type AgentQuestionToolResult = { questionId: string; question: AgentQuestionInput } & (
  | { kind: 'answer'; answer: Exclude<AgentQuestionAnswer, { kind: 'skip' }> }
  | { kind: 'no_answer'; reason: 'skipped' | 'expired' | 'cancelled' }
)

/** A question waiting for the owner's answer. Answered questions live on in the transcript. */
export interface AgentQuestion {
  id: string
  agentId: string
  conversationId: string
  question: AgentQuestionInput
  createdAt: number
  expiresAt: number
}

export interface AgentQuestionListResponse {
  questions: AgentQuestion[]
}

export interface AnswerAgentQuestionRequest {
  answer: AgentQuestionAnswer
}
