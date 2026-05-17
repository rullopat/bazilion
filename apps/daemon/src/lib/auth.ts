// Token verification primitives — framework-agnostic. The Hono auth middleware
// (lib/middleware-auth.ts) wraps these; native clients (CLI, mobile) pass the
// same token via `Authorization: Bearer …`, and browsers send the httpOnly
// `bz_token` cookie minted by `POST /api/login`.
//
// All tokens — including the bootstrap one minted by the daemon's first-run
// bootstrap — live as hashed rows in the `web_tokens` table. The bootstrap
// row's plaintext is exposed in `~/.bazilion/auth.json` so the daemon (PBKDF2
// seed for the secrets table) and the CLI (loopback bearer) can use it.
// Validation goes through `findActiveByToken`, no special-case loopback path.

import { webTokenRepo } from '../core/index.ts'
import { getCtx } from './ctx.ts'

/**
 * Is this string a currently-valid token? Accepts any active (non-revoked)
 * row in `web_tokens` — including the bootstrap row written by the daemon's
 * first-run bootstrap. Bumps `last_used_at` on a match so operators can see
 * idle vs active tokens in `token list`.
 */
export function isValidToken(token: string): boolean {
  try {
    const { db } = getCtx()
    const match = webTokenRepo.findActiveByToken(db, token)
    if (match) {
      webTokenRepo.markUsed(db, match.id)
      return true
    }
  } catch {
    // db unavailable — treat as unauthenticated
  }
  return false
}

/** Pull the bearer token out of an `Authorization: Bearer …` header. */
export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  // RFC 6750 auth scheme is case-insensitive.
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authHeader)
  return match?.[1] ?? null
}
