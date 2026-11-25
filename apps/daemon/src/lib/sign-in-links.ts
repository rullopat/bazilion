// One-time sign-in links: the CLI, which holds a token, asks for one and opens it in the browser,
// so the browser gets a session without anyone pasting the token. A link's code is random, used
// once and valid for two minutes, and lives only in the daemon's memory.

import { randomBytes } from 'node:crypto'

export const SIGN_IN_LINK_TTL_MS = 2 * 60_000
/** Codes not yet used; more than this and the oldest are dropped. */
const MAX_PENDING = 20

interface Pending {
  tokenId: string
  expiresAt: number
}

const pending = new Map<string, Pending>()

function prune(now: number): void {
  for (const [code, link] of pending) if (link.expiresAt <= now) pending.delete(code)
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) break
    pending.delete(oldest)
  }
}

/** A new code for a session of this token. */
export function createSignInCode(
  tokenId: string,
  now = Date.now(),
): { code: string; expiresAt: number } {
  prune(now)
  const code = randomBytes(32).toString('base64url')
  const expiresAt = now + SIGN_IN_LINK_TTL_MS
  pending.set(code, { tokenId, expiresAt })
  return { code, expiresAt }
}

/** The token a code was made for, once: a used, expired or unknown code gives null. */
export function consumeSignInCode(code: string, now = Date.now()): string | null {
  const link = pending.get(code)
  if (!link) return null
  pending.delete(code)
  return link.expiresAt > now ? link.tokenId : null
}

export function _resetSignInCodesForTest(): void {
  pending.clear()
}
