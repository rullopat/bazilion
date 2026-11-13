/** A file an Agent delivered or generated, saved by the daemon. */
export interface AgentResult {
  id: string
  teamId: string
  agentId: string
  /** The conversation it was delivered in. */
  sessionId: string
  toolCallId: string
  /** Position among the images of one image_generate call; 0 otherwise. */
  sourceIndex: number
  name: string
  mimeType: string
  byteLength: number
  sha256: string
  /** The image model that generated it; null for delivered files. */
  imageModel: string | null
  createdAt: number
}

/** Kept in the tool result of the transcript; resolved through the daemon. */
export interface ResultReference {
  resultId: string
}

export interface ResultListResponse {
  results: AgentResult[]
  total: number
  offset: number
  limit: number
}
