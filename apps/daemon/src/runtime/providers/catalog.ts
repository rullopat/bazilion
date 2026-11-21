// "Which models does provider X offer?" for Setup and `bazilion provider models`: Pi's bundled
// catalog with what it knows about each model, plus a live `GET <url>/models` for providers that
// list models that way (local servers show exactly what they have loaded).

import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { fetch as undiciFetch } from 'undici'
import { piProviderName, providerApiKey, providerModelsUrl } from '../../core/providers.ts'

/** One model of Pi's catalog, with the facts worth showing when choosing one. */
export interface CatalogEntry {
  id: string
  name: string
  contextWindow: number
  /** It takes images as input. */
  images: boolean
  reasoning: boolean
  /** List price in US dollars per million tokens; absent when the catalog prices it at zero. */
  price?: { input: number; output: number }
}

interface PiModel {
  id: string
  name?: string
  contextWindow?: number
  input?: readonly string[]
  reasoning?: boolean
  cost?: { input?: number; output?: number }
}

/** Pi's bundled catalog for one provider, with its facts; no network. */
export function listCatalogEntries(providerName: string): CatalogEntry[] {
  const models = (getBuiltinModels as unknown as (provider: string) => PiModel[] | undefined)(
    piProviderName(providerName),
  )
  return (models ?? []).map((model) => {
    const input = model.cost?.input ?? 0
    const output = model.cost?.output ?? 0
    return {
      id: model.id,
      // Pi marks the undated alias "(latest)"; the dated copy is told apart by its id.
      name: (model.name ?? model.id).replace(/ \(latest\)$/, ''),
      contextWindow: model.contextWindow ?? 0,
      images: model.input?.includes('image') ?? false,
      reasoning: model.reasoning ?? false,
      // Subscription and free endpoints are priced at zero, which says nothing about cost.
      ...(input > 0 || output > 0 ? { price: { input, output } } : {}),
    }
  })
}

/** Pi's bundled catalog for one provider, as model ids. */
export function listCatalogModelsSync(providerName: string): string[] {
  return listCatalogEntries(providerName).map((model) => model.id)
}

const DATED = /^(.+)-(\d{8}|\d{4}-\d{2}-\d{2})$/

/** The ids that are dated copies of another id in the same list (`claude-haiku-4-5-20251001`). */
export function datedCopies(ids: readonly string[]): Set<string> {
  const all = new Set(ids)
  return new Set(
    ids.filter((id) => {
      const base = DATED.exec(id)?.[1]
      return base !== undefined && all.has(base)
    }),
  )
}

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
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    return { models: [], error: cause?.code ?? cause?.message ?? (err as Error).message }
  }
}

/** The provider's own model list, when it has one (`GET <url>/models`). */
export async function listLiveModels(
  providerName: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<LiveFetchResult | undefined> {
  const url = providerModelsUrl(providerName, env)
  if (!url) return undefined
  return fetchLiveModels(url, providerApiKey(providerName, env), signal)
}

export async function listCatalogModels(
  providerName: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  const catalog = listCatalogModelsSync(providerName)
  const live = await listLiveModels(providerName, env, signal)
  return live ? { catalog, live } : { catalog }
}
