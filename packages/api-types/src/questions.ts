export interface AgentQuestionChoice {
  label: string
  description?: string
}

/** One question of an `ask_user` card. */
export interface AgentQuestionItem {
  prompt: string
  choices: AgentQuestionChoice[]
  recommendedIndex?: number
  /** The owner may pick several choices. */
  multiple?: boolean
}

/**
 * Something only the owner can do (sign in to a site, confirm in an app, plug in a device). It
 * does not hold the Agent's turn: the owner's Done or Can't starts the next one.
 */
export interface AgentQuestionAction {
  /** Why the Agent needs it, in a line. */
  reason: string
  /** What to do. */
  instructions: string
  /** The page to do it on, when there is one. */
  url?: string
}

/**
 * A credential an Agent asks for by name (`secret_request`). Like an action it does not hold the
 * turn. The value goes to the daemon's secret store, never to the Agent or the transcript: the
 * Agent is woken with "stored" or "declined".
 */
export interface AgentQuestionSecret {
  /** An environment-variable name, such as GITHUB_TOKEN. */
  name: string
  /** Why the Agent needs it, in a line. */
  reason: string
  /** The hosts `web_fetch` may send it to; none means commands only. */
  hosts?: string[]
}

/**
 * What an Agent asks: questions shown in one card and answered together, or an action (both
 * `ask_user`), or a secret (`secret_request`). Exactly one. Answers are information only and grant
 * no permission.
 */
export interface AgentQuestionInput {
  questions?: AgentQuestionItem[]
  action?: AgentQuestionAction
  secret?: AgentQuestionSecret
}

/** The answer to one question of a card. */
export type AgentQuestionItemAnswer =
  | { kind: 'choice'; index: number }
  | { kind: 'choices'; indexes: number[] }
  | { kind: 'text'; text: string }
  | { kind: 'skip' }

/** What the owner sends. */
export type AgentQuestionAnswer =
  /** One per question, in order; a question may be skipped. */
  | { kind: 'answers'; answers: AgentQuestionItemAnswer[] }
  /** The whole card, skipped. */
  | { kind: 'skip' }
  /** An action, done or not, with an optional note. */
  | { kind: 'done'; note?: string }
  | { kind: 'cannot'; note?: string }
  /** A secret, given (stored, never shown again) or declined. */
  | { kind: 'secret'; value: string }
  | { kind: 'decline'; note?: string }

/** What `ask_user` returns to the model. */
export type AgentQuestionToolResult = { questionId: string; question: AgentQuestionInput } & (
  | { kind: 'answer'; answers: AgentQuestionItemAnswer[] }
  | { kind: 'no_answer'; reason: 'skipped' | 'expired' | 'cancelled' }
  /** An action, handed to the owner: the turn ends, and their answer starts the next. */
  | { kind: 'action_asked' }
)

/** A question card or an action waiting for the owner. Answered ones live on in the transcript. */
export interface AgentQuestion {
  id: string
  agentId: string
  conversationId: string
  question: AgentQuestionInput
  createdAt: number
  /** When a card stops waiting; null for an action, which waits until it is answered. */
  expiresAt: number | null
  /** Answers given question by question (Telegram) before the card is complete; null: not yet. */
  answered?: Array<AgentQuestionItemAnswer | null>
}

export interface AgentQuestionListResponse {
  questions: AgentQuestion[]
}

export interface AnswerAgentQuestionRequest {
  answer: AgentQuestionAnswer
}

/** A line naming what is asked: the action's reason, or the first question (and how many more). */
export function questionTitle(input: AgentQuestionInput): string {
  if (input.secret) return `${input.secret.name}: ${input.secret.reason}`
  if (input.action) return input.action.reason
  const [first, ...rest] = input.questions ?? []
  if (!first) return 'A question'
  return rest.length > 0 ? `${first.prompt} (and ${rest.length} more)` : first.prompt
}
