// The Access page: what minting a token sends, and how a token is doing.

import type { CreateTokenRequest, WebToken } from '@bazilion/api-types'
import type { Tone } from './model-facts'

export interface TokenDraft {
  label: string
  /** Days until it expires, as typed; empty for a token that never does. */
  days: string
}

export interface TokenForm {
  problems: { days?: string }
  /** What is still needed, once something was typed; null when nothing is missing. */
  missing: string | null
  /** What Create sends; null while the label is missing or the days are wrong. */
  body: CreateTokenRequest | null
}

export function tokenForm(draft: TokenDraft): TokenForm {
  const label = draft.label.trim()
  const days = draft.days.trim()
  const problems: TokenForm['problems'] = {}
  if (days !== '' && (!/^\d+$/.test(days) || Number(days) < 1)) {
    problems.days = 'A whole number of days, 1 or more. Empty means it never expires.'
  }
  const missing =
    label === '' && days !== '' ? 'A token needs a label to tell it from the others.' : null
  if (label === '' || problems.days) return { problems, missing, body: null }
  return { problems, missing, body: { label, ...(days ? { expiresInDays: Number(days) } : {}) } }
}

/** Whether a token still signs in. */
export function tokenState(token: WebToken, now: number): { label: string; tone: Tone } {
  if (token.revokedAt) return { label: 'Revoked', tone: 'neutral' }
  if (token.expiresAt !== null && token.expiresAt <= now)
    return { label: 'Expired', tone: 'neutral' }
  return { label: 'Active', tone: 'success' }
}

/** A moment as the daemon's clock has it, to the minute. */
export function when(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')
}
