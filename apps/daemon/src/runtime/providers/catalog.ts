// "Which models does provider X offer?" for /config and `bazilion provider models`: Pi's bundled
// catalog, plus a live `GET <url>/models` for providers that list models that way (local servers
// show exactly what they have loaded).

import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { fetch as undiciFetch } from 'undici'
import { piProviderName, providerApiKey, providerModelsUrl } from '../../core/providers.ts'

export interface LiveFetchResult {
  models: string[]
  /** Set when the listing failed, so the UI can say so instead of showing nothing. */
  error?: string
}

export interface CatalogResult {
  /** Pi's bundled catalog; no network. */
  catalog: string[]
  /** The live listing; omitted for providers that offer none. */
  live?: LiveFetchResult
}

/** Pi's bundled catalog for one provider. */
export function listCatalogModelsSync(providerName: string): string[] {
  const models = (
    getBuiltinModels as unknown as (provider: string) => Array<{ id: string }> | undefined
  )(piProviderName(providerName))
  return (models ?? []).map((model) => model.id)
}

async function fetchLiveModels(
  baseUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<LiveFetchResult> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await undiciFetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers, signal })
    if (!res.ok) return { models: [], error: `${res.status} ${res.statusText}` }
    const body = (await res.json()) as { data?: Array<{ id?: string }> } | null
    return { models: (body?.data ?? []).flatMap((model) => (model.id ? [model.id] : [])) }
  } catch (err) {
    return { models: [], error: (err as Error).message }
  }
}

export async function listCatalogModels(
  providerName: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  const catalog = listCatalogModelsSync(providerName)
  const url = providerModelsUrl(providerName, env)
  if (!url) return { catalog }
  return { catalog, live: await fetchLiveModels(url, providerApiKey(providerName, env), signal) }
}
