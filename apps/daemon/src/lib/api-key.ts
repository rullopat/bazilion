// Resolves the API key (and refresher) for an agent's provider. Centralizes
// the OAuth special case for `openai-codex` — its access token lives in the
// daemon-owned `secrets` table, not in env vars, so callers can't pluck it
// from the merged env the way they can for plain API-key providers.

import type { ResolvedAgent } from '@bazilion/api-types'
import type { BazilionDb } from '../core/index.ts'
import { hasOpenAICodexCredentials, loadOpenAICodexAccessToken } from '../runtime/index.ts'

export interface AgentApiKey {
  /** Initial access token / API key. Undefined when the env layer carries it. */
  apiKey?: string
  /**
   * Optional refresher pi calls during long tool-execution loops to swap an
   * expired JWT for a fresh one. Only set for OAuth providers. Daemon-side
   * sessions call it directly; worker turns reach the same callback through
   * their turn-scoped IPC channel and remain DB-free.
   */
  refreshApiKey?: (providerName: string) => Promise<string>
}

/**
 * Pre-fetch the API key for `agent`'s provider. Returns `{}` when the
 * provider is env-key-based (the merged env passed to the session already
 * carries the value). For `openai-codex`, throws a friendly error when the
 * user hasn't connected their ChatGPT account yet — that surfaces in the
 * chat UI as a clear "go to /config" message rather than pi's generic
 * "no API key" complaint.
 */
export async function resolveAgentApiKey(
  db: BazilionDb,
  authToken: string,
  agent: ResolvedAgent,
  opts: { withRefresher?: boolean } = {},
): Promise<AgentApiKey> {
  const providerName = agent.model.split(':', 1)[0] ?? ''
  if (providerName !== 'openai-codex') return {}

  if (!hasOpenAICodexCredentials(db, authToken)) {
    throw new Error(
      'openai-codex is not connected — run `bazilion auth openai login` or click Connect on /config',
    )
  }
  const apiKey = await loadOpenAICodexAccessToken(db, authToken)
  if (!opts.withRefresher) return { apiKey }
  return {
    apiKey,
    refreshApiKey: async (requestedProvider) => {
      if (requestedProvider !== 'openai-codex') {
        throw new Error(`unexpected refresh request for ${requestedProvider}`)
      }
      return loadOpenAICodexAccessToken(db, authToken)
    },
  }
}
