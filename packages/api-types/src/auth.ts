import type { WebSession, WebToken } from './entities.ts'

export interface CreateTokenRequest {
  label: string
  /** Expire the token after this many days. Omitted: the token never expires. */
  expiresInDays?: number
}

export interface CreateTokenResponse {
  /** Plaintext token — returned exactly once. */
  token: string
  meta: WebToken
}

export interface ListTokensResponse {
  tokens: WebToken[]
}

export interface ListSessionsResponse {
  sessions: WebSession[]
}

/** `GET /api/auth/whoami`. */
export interface AuthenticatedOwnerResponse {
  authenticated: true
  setupComplete: boolean
  publicOrigin: string | null
  principal: {
    kind: 'bootstrap' | 'device' | 'session'
    tokenId: string
    label: string
    sessionId: string | null
  }
}
