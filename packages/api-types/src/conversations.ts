/** Routing metadata only. Pi JSONL remains the conversation transcript. */
export interface Conversation {
  id: string
  agentId: string
  title: string
  titleRevision: number
  createdAt: number
  updatedAt: number
}

export interface ConversationSelection {
  conversationId: string | null
  revision: number
}

export interface ConversationListResponse {
  conversations: Conversation[]
  selection: ConversationSelection
  total: number
  offset: number
  limit: number
}

export interface NewConversationInput {
  /** UUID retained by the client for reconciliation after a lost response. */
  requestId: string
  expectedSelection: ConversationSelection
  title?: string
}

/** Daemon-admitted canonical transcript binding passed to the worker. */
export interface ConversationTarget {
  id: string
  filename: string
}
