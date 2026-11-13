/** Conversation metadata. Pi's session file `<id>.jsonl` holds the transcript. */
export interface Conversation {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ConversationListResponse {
  conversations: Conversation[]
  /** The conversation new turns write to; null before the Agent's first turn. */
  selectedId: string | null
  total: number
  offset: number
  limit: number
}

export interface NewConversationInput {
  title?: string
}

/** The conversation a turn writes to, passed to the worker. Its transcript is `<id>.jsonl`. */
export interface ConversationTarget {
  id: string
}
