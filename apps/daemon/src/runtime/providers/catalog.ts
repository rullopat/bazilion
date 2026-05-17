// Catalog lookup for config UI + CLI: "what models does provider X offer?"
//
// Two sources, merged and de-duplicated:
//   1. pi-ai's typed catalog (`getModels(provider)`) — static list of
//      known cloud models with cost + context-window metadata, bundled with
//      pi-ai. Works for the 10ish KnownProvider names; empty for local /
//      alias providers (lmstudio, ollama, bedrock-via-our-alias).
//   2. For OpenAI-compat endpoints (lmstudio, ollama, openrouter,
//      vercel-ai-gateway, openai with custom baseURL), we query
//      `GET {baseURL}/models` and extract `data[].id`. This picks up
//      newly released models, user-loaded local models, etc.
//
// `listCatalogModels(providerName)` returns the union. Errors from live
// fetches are surfaced so callers can show "couldn't reach lmstudio" rather
// than a silent empty list.

import { getModels as piGetModels } from '@mariozechner/pi-ai'

// piProviderName: what pi-ai's catalog indexes by. For bedrock we use the
// Bazilion-registry-key 'bedrock' externally but pi uses 'amazon-bedrock'.
const REGISTRY_TO_PI: Record<string, string> = {
  bedrock: 'amazon-bedrock',
  'azure-openai': 'azure-openai-responses',
}

// baseURL for providers whose /v1/models we can probe. Omitted for the
// big cloud APIs that require a real key and generally aren't "explore me"
// — those come from the pi catalog. `process.env` reads pick up the same
// secrets/config merge the rest of the runtime uses.
function liveEndpointFor(providerName: string, env: NodeJS.ProcessEnv): string | null {
  switch (providerName) {
    case 'lmstudio':
      return env.LMSTUDIO_URL ?? 'http://127.0.0.1:1234/v1'
    case 'ollama':
      // Ollama has its own /api/tags for model list; its OpenAI-compat /v1
      // endpoint supports /models though, so use that.
      return env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'
    case 'openrouter':
      return 'https://openrouter.ai/api/v1'
    case 'vercel-ai-gateway':
      return env.AI_GATEWAY_BASE_URL ?? 'https://ai-gateway.vercel.sh/v1'
    case 'groq':
      return 'https://api.groq.com/openai/v1'
    case 'cerebras':
      return 'https://api.cerebras.ai/v1'
    case 'xai':
      return 'https://api.x.ai/v1'
    case 'mistral':
      return 'https://api.mistral.ai/v1'
    default:
      return null
  }
}

function piModels(providerName: string): string[] {
  const piName = REGISTRY_TO_PI[providerName] ?? providerName
  try {
    const models = (piGetModels as unknown as (p: string) => { id: string }[] | undefined)(piName)
    if (!models) return []
    return models.map((m) => m.id)
  } catch {
    return []
  }
}

export interface LiveFetchResult {
  models: string[]
  /** Only populated on failure; caller renders for UX. */
  error?: string
}

async function fetchModelsFrom(
  baseURL: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<LiveFetchResult> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, { headers, signal })
    if (!res.ok) return { models: [], error: `${res.status} ${res.statusText}` }
    const body = (await res.json()) as { data?: Array<{ id?: string }> } | null
    const ids = (body?.data ?? []).map((m) => m.id).filter((id): id is string => !!id)
    return { models: ids }
  } catch (err) {
    return { models: [], error: (err as Error).message }
  }
}

function apiKeyFor(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  switch (providerName) {
    case 'lmstudio':
      return env.LMSTUDIO_API_KEY ?? 'lm-studio'
    case 'ollama':
      return env.OLLAMA_API_KEY ?? 'ollama'
    case 'openrouter':
      return env.OPENROUTER_API_KEY
    case 'vercel-ai-gateway':
      return env.AI_GATEWAY_API_KEY
    case 'groq':
      return env.GROQ_API_KEY
    case 'cerebras':
      return env.CEREBRAS_API_KEY
    case 'xai':
      return env.XAI_API_KEY
    case 'mistral':
      return env.MISTRAL_API_KEY
    default:
      return undefined
  }
}

export interface CatalogResult {
  /** Models from pi-ai's typed catalog — stable, no network. */
  catalog: string[]
  /** Live `/v1/models` query — populated only for openai-compat endpoints we know how to probe. */
  live?: LiveFetchResult
}

/**
 * List known models for a provider. Combines pi's static catalog with a live
 * `/v1/models` query for endpoints that expose one. Returns both separately
 * so the UI can surface which ones come from where.
 *
 * `live` is omitted (not just empty) when the provider doesn't expose a
 * `/v1/models` endpoint — e.g. Anthropic or Bedrock. Those rely on the
 * catalog only.
 */
export async function listCatalogModels(
  providerName: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  const catalog = piModels(providerName)
  const endpoint = liveEndpointFor(providerName, env)
  if (!endpoint) return { catalog }
  const key = apiKeyFor(providerName, env)
  const live = await fetchModelsFrom(endpoint, key, signal)
  return { catalog, live }
}

/** Synchronous variant for contexts that only want the pi catalog slice. */
export function listCatalogModelsSync(providerName: string): string[] {
  return piModels(providerName)
}
