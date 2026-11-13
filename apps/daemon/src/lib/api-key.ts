// The provider gate a turn, `/compact` and the provider test pass before they start, and the
// credential lookup for sessions: `openai-codex` needs its OAuth access token, which lives in the
// daemon-owned `secrets` table rather than in the env.

import type { ResolvedAgent } from '@bazilion/api-types'
import { type BazilionDb, providerStateRepo } from '../core/index.ts'
import { findProvider, parseModelString } from '../core/providers.ts'
import { hasOpenAICodexCredentials, loadOpenAICodexAccessToken } from '../runtime/index.ts'
import { ExecutionUnavailableError } from './execution-unavailable.ts'

export interface AgentApiKey {
  /** Initial access token. Undefined for env-key providers: the merged env carries the key. */
  apiKey?: string
  /**
   * Refresher Pi calls during long tool loops to swap an expired token for a fresh one; set only
   * for OAuth providers. Worker turns reach it through their turn-scoped IPC channel.
   */
  refreshApiKey?: (providerName: string) => Promise<string>
}

/**
 * Refuse a `provider:model` its provider cannot serve: a malformed model, an unknown provider, a
 * provider disabled on /config, or `openai-codex` without a connected ChatGPT account.
 */
export function assertProviderReady(db: BazilionDb, authToken: string, model: string): void {
  let providerName: string
  try {
    providerName = parseModelString(model).providerName
  } catch (error) {
    throw new ExecutionUnavailableError((error as Error).message)
  }
  if (!findProvider(providerName)) {
    throw new ExecutionUnavailableError(`unknown provider: ${providerName}`)
  }
  if (!providerStateRepo.listEnabled(db).has(providerName)) {
    throw new ExecutionUnavailableError(
      `${providerName} provider is disabled — enable it on the /config page`,
    )
  }
  if (providerName === 'openai-codex' && !hasOpenAICodexCredentials(db, authToken)) {
    throw new ExecutionUnavailableError(
      'openai-codex is not connected — run `bazilion auth openai login` or click Connect on /config',
    )
  }
}

/** The ChatGPT access token and its refresher for an `openai-codex` Agent; `{}` otherwise. */
export async function resolveAgentApiKey(
  db: BazilionDb,
  authToken: string,
  agent: ResolvedAgent,
): Promise<AgentApiKey> {
  if (parseModelString(agent.model).providerName !== 'openai-codex') return {}
  return {
    apiKey: await loadOpenAICodexAccessToken(db, authToken),
    refreshApiKey: async (requestedProvider) => {
      if (requestedProvider !== 'openai-codex') {
        throw new Error(`unexpected refresh request for ${requestedProvider}`)
      }
      return loadOpenAICodexAccessToken(db, authToken)
    },
  }
}
