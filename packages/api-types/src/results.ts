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
  /** Ordinal within one tool call (zero for ordinary files). */
  sourceIndex?: number
  /** Selected image route/model, not a backend attestation; null for ordinary files. */
  imageModel?: string | null
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

/** Approved owner-only inventory: deliberately no filename, prompt, model, hash or source. */
export interface PrivateImageCapture {
  id: string
  teamId: string
  agentId: string
  createdAt: number
  byteLength: number
}

export interface PrivateImageCaptureListResponse {
  captures: PrivateImageCapture[]
  total: number
  privateBytes: number
  /** All retained Results bytes in this home, including ordinary and released files. */
  retainedBytes: number
  limit: number
  offset: number
}

export type PrivateImageRecoveryResponse =
  | { resultId: string; status: 'released' | 'already_released' }
  | { resultId: string; status: 'approval_required'; approvalId: string }
  | {
      resultId: string
      status: 'blocked'
      reason:
        | 'producer_active'
        | 'producer_unavailable'
        | 'delivery_pending'
        | 'delivery_closed'
        | 'policy_denied'
      approvalStatus?: import('./entities.ts').CommunicationApprovalStatus
    }

export interface PrivateImageDiscardResponse {
  resultId: string
  discarded: true
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
