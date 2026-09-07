/** A daemon-owned immutable snapshot, or its retained deletion receipt. */
export interface AgentResult {
  id: string
  teamId: string
  agentId: string
  sessionId: string
  toolCallId: string
  name: string
  mimeType: string
  byteLength: number
  sha256: string
  createdAt: number
  releasedAt: number | null
  deletedAt: number | null
}

/** Persisted in the canonical tool-result details; resolved through the daemon. */
export interface ResultReference {
  resultId: string
}

export interface ResultListResponse {
  results: AgentResult[]
  total: number
  offset: number
  limit: number
}

/** Private worker-to-daemon publication message; ownership is bound by the daemon. */
export interface ResultPublicationInput {
  sessionId: string
  toolCallId: string
  name: string
  mimeType: string
  data: string
}

export type ResultSourceResponse =
  | { available: false }
  | {
      available: true
      agentId: string
      sessionId: string
      messages: import('./events.ts').ProviderMessage[]
    }
