// OpenAI ChatGPT / Codex OAuth — token storage + refresh on top of pi-ai.
//
// Pi-ai ships a complete OAuth flow for the ChatGPT backend (`@earendil-works/pi-ai`
// exports `loginOpenAICodex` + `refreshOpenAICodexToken`), so this module is
// thin: it adapts the credential I/O to Bazilion's encrypted secrets store
// and exposes a single `loadAccessToken(db, authToken)` call that refreshes
// when the token is about to expire.
//
// Storage: the JSON blob `{refresh, access, expires}` lives under the
// secrets key `OPENAI_CODEX_OAUTH` in the `secrets` table. The blob is
// never copied into the env (unlike plain-API-key providers) — refresh is
// stateful, so every call reads and writes through the live secrets store.

import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { OAuthCredentials } from '@earendil-works/pi-ai'
import { loginOpenAICodex, refreshOpenAICodexToken } from '@earendil-works/pi-ai/oauth'
import { type BazilionDb, openSecrets } from '../../core/index.ts'

export const OPENAI_CODEX_SECRET_KEY = 'OPENAI_CODEX_OAUTH'

/** Refresh when the access token has less than this much life left. */
const REFRESH_MARGIN_MS = 60_000

export interface StoredCredentials {
  refresh: string
  access: string
  expires: number
}

function readCredentials(db: BazilionDb, authToken: string): StoredCredentials | null {
  const raw = openSecrets(db, authToken).get(OPENAI_CODEX_SECRET_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>
    if (
      typeof parsed.refresh === 'string' &&
      typeof parsed.access === 'string' &&
      typeof parsed.expires === 'number'
    ) {
      return { refresh: parsed.refresh, access: parsed.access, expires: parsed.expires }
    }
    return null
  } catch {
    return null
  }
}

function writeCredentials(db: BazilionDb, authToken: string, creds: StoredCredentials): void {
  openSecrets(db, authToken).set(OPENAI_CODEX_SECRET_KEY, JSON.stringify(creds))
}

export function clearCredentials(db: BazilionDb, authToken: string): void {
  openSecrets(db, authToken).remove(OPENAI_CODEX_SECRET_KEY)
}

export function hasCredentials(db: BazilionDb, authToken: string): boolean {
  return readCredentials(db, authToken) !== null
}

function decodeAccountId(accessToken: string): string | null {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1] as string, 'base64').toString('utf8')) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string }
    }
    return payload['https://api.openai.com/auth']?.chatgpt_account_id ?? null
  } catch {
    return null
  }
}

export function getStatus(db: BazilionDb, authToken: string): OpenAICodexStatus {
  const creds = readCredentials(db, authToken)
  if (!creds) return { connected: false, expiresAt: null, accountId: null }
  return {
    connected: true,
    expiresAt: creds.expires,
    accountId: decodeAccountId(creds.access),
  }
}

/**
 * Returns a valid access token, refreshing via pi-ai if the stored one is
 * within `REFRESH_MARGIN_MS` of expiry. Throws when no credentials are stored
 * so callers can surface an actionable "run `bazilion auth openai login`"
 * error rather than a 401 from the upstream API.
 */
export async function loadAccessToken(db: BazilionDb, authToken: string): Promise<string> {
  const creds = readCredentials(db, authToken)
  if (!creds) {
    throw new Error(
      'OpenAI ChatGPT OAuth not configured — run `bazilion auth openai login` (or use the Connect button on /config)',
    )
  }
  if (creds.expires > Date.now() + REFRESH_MARGIN_MS) return creds.access

  const refreshed = (await refreshOpenAICodexToken(creds.refresh)) as OAuthCredentials
  const next: StoredCredentials = {
    refresh: refreshed.refresh,
    access: refreshed.access,
    expires: refreshed.expires,
  }
  writeCredentials(db, authToken, next)
  return next.access
}

/** Persist credentials fetched by pi-ai's `loginOpenAICodex`. */
export function saveLoginCredentials(
  db: BazilionDb,
  authToken: string,
  creds: OAuthCredentials,
): void {
  writeCredentials(db, authToken, {
    refresh: creds.refresh,
    access: creds.access,
    expires: creds.expires,
  })
}

export { loginOpenAICodex, refreshOpenAICodexToken }
