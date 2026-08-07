// OpenAI ChatGPT / Codex OAuth — token storage + refresh on top of pi-ai.
//
// Pi-ai ships a complete OAuth flow for the ChatGPT backend through its
// `openai-codex` provider, so this module is
// thin: it adapts the credential I/O to Bazilion's encrypted secrets store
// and exposes a single `loadAccessToken(db, authToken)` call that refreshes
// when the token is about to expire.
//
// Storage: Pi's complete OAuth credential blob lives under the
// secrets key `OPENAI_CODEX_OAUTH` in the `secrets` table. The blob is
// never copied into the env (unlike plain-API-key providers) — refresh is
// stateful, so every call reads and writes through the live secrets store.

import type { OpenAICodexStatus } from '@bazilion/api-types'
import type { AuthInteraction, OAuthCredential, OAuthCredentials } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { type BazilionDb, openSecrets } from '../../core/index.ts'

export const OPENAI_CODEX_SECRET_KEY = 'OPENAI_CODEX_OAUTH'

/** Refresh when the access token has less than this much life left. */
const REFRESH_MARGIN_MS = 60_000

/**
 * One refresh flight per daemon DB/auth context. Multiple Agents can reach the
 * expiry margin at the same time; without single-flight they would all submit
 * the same (potentially rotating) refresh token and race the credentials write.
 * The WeakMap lets closed DB handles and their nested maps be collected.
 */
const refreshFlights = new WeakMap<BazilionDb, Map<string, Promise<string>>>()

function openAICodexOAuth() {
  const oauth = openaiCodexProvider().auth.oauth
  if (!oauth) throw new Error('Pi openai-codex provider does not expose OAuth')
  return oauth
}

export async function loginOpenAICodex(interaction: AuthInteraction): Promise<OAuthCredential> {
  return openAICodexOAuth().login(interaction)
}

export async function refreshOpenAICodexToken(
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  return openAICodexOAuth().refresh(credential)
}

export type StoredCredentials = OAuthCredential

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
      // Older Bazilion rows predate Pi's type discriminator. Normalizing here
      // keeps those rows readable while preserving all provider-specific fields.
      return { ...parsed, type: 'oauth' } as StoredCredentials
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
    throw credentialsMissingError()
  }
  if (creds.expires > Date.now() + REFRESH_MARGIN_MS) return creds.access

  let dbFlights = refreshFlights.get(db)
  if (!dbFlights) {
    dbFlights = new Map()
    refreshFlights.set(db, dbFlights)
  }

  const existing = dbFlights.get(authToken)
  if (existing) return existing

  // Publish the flight before starting it. The microtask boundary makes the
  // credential re-read below happen after publication, so every concurrent
  // caller observes this same Promise instead of starting a second refresh.
  const pending = Promise.resolve().then(() => refreshExpiredAccessToken(db, authToken))
  dbFlights.set(authToken, pending)
  try {
    return await pending
  } finally {
    if (dbFlights.get(authToken) === pending) dbFlights.delete(authToken)
    if (dbFlights.size === 0) refreshFlights.delete(db)
  }
}

async function refreshExpiredAccessToken(db: BazilionDb, authToken: string): Promise<string> {
  // Credentials may have been refreshed or replaced between the caller's
  // initial expiry check and this flight acquiring ownership. Re-read after
  // publishing the flight and skip the network call when another path won.
  const creds = readCredentials(db, authToken)
  if (!creds) throw credentialsMissingError()
  if (creds.expires > Date.now() + REFRESH_MARGIN_MS) return creds.access

  const next = await refreshOpenAICodexToken(creds)

  // A logout or a new login can happen while the network request is pending.
  // Never resurrect cleared credentials or overwrite a newer credential set.
  const current = readCredentials(db, authToken)
  if (!current) throw credentialsMissingError()
  if (!sameCredentials(current, creds)) {
    if (current.expires > Date.now() + REFRESH_MARGIN_MS) return current.access
    throw new Error('OpenAI ChatGPT OAuth credentials changed while refresh was in progress')
  }

  writeCredentials(db, authToken, next)
  return next.access
}

function credentialsMissingError(): Error {
  return new Error(
    'OpenAI ChatGPT OAuth not configured — run `bazilion auth openai login` (or use the Connect button on /config)',
  )
}

function sameCredentials(left: StoredCredentials, right: StoredCredentials): boolean {
  return (
    left.refresh === right.refresh && left.access === right.access && left.expires === right.expires
  )
}

/** Persist credentials fetched by pi-ai's `loginOpenAICodex`. */
export function saveLoginCredentials(
  db: BazilionDb,
  authToken: string,
  creds: OAuthCredentials,
): void {
  writeCredentials(db, authToken, { ...creds, type: 'oauth' })
}
