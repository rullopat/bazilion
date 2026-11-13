// Token verification primitives. Native clients (CLI) pass a token as
// `Authorization: Bearer …`; browsers hold a hashed session cookie minted by
// `POST /api/login` (lib/middleware-auth.ts accepts both).
//
// All tokens — including the bootstrap one minted by the daemon's first-run
// bootstrap — live as hashed rows in the `web_tokens` table and grant full
// access. The bootstrap row's plaintext is exposed in `~/.bazilion/auth.json`
// so the daemon (PBKDF2 seed for the secrets table) and the CLI (loopback
// bearer) can use it.

import { webTokenRepo } from '../core/index.ts'
import type { AuthenticatedSession } from '../core/repos/webSessions.ts'
import { getCtx } from './ctx.ts'

export interface BearerPrincipal {
  kind: 'bootstrap' | 'device'
  tokenId: string
  label: string
  sessionId: null
}

export interface SessionPrincipal {
  kind: 'session'
  tokenId: string
  label: string
  sessionId: string
}

export type AuthPrincipal = BearerPrincipal | SessionPrincipal

export interface AuthVariables {
  authPrincipal: AuthPrincipal
  authSession: AuthenticatedSession
}

/**
 * Resolve an active (unrevoked, unexpired) token to its principal, bumping
 * `last_used_at` so `token list` shows idle vs active tokens.
 */
export function authenticateToken(token: string): BearerPrincipal | null {
  try {
    const { db } = getCtx()
    const match = webTokenRepo.findActiveByToken(db, token)
    if (match) {
      webTokenRepo.markUsed(db, match.id)
      return { kind: match.kind, tokenId: match.id, label: match.label, sessionId: null }
    }
  } catch {
    // db unavailable — treat as unauthenticated
  }
  return null
}

/** Pull the bearer token out of an `Authorization: Bearer …` header. */
export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  // RFC 6750 auth scheme is case-insensitive.
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authHeader)
  return match?.[1] ?? null
}
