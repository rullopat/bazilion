// Pi model runtime for one provider:model, with credentials held in memory only: Pi never reads
// or writes its own auth or model files, and never fetches catalogs from the network.

import type { ProviderTestResponse } from '@bazilion/api-types'
import type { Api, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fetch as undiciFetch } from 'undici'
import {
  findProvider,
  parseModelString,
  piProviderName,
  providerApiKey,
  providerCredentialEnv,
  providerEndpoint,
} from '../../core/providers.ts'
import { catalogContextWindow } from './catalog.ts'

export interface PiModelSpec {
  providerName: string
  modelId: string
  /** Where credentials and the endpoint are read from (the merged daemon env, or a projection). */
  env: Readonly<Record<string, string | undefined>>
  /** Wins over the key in `env`: the ChatGPT access token, a review worker's selected key. */
  apiKey?: string
  /** Wins over the endpoint in `env`. */
  baseUrl?: string
}

/**
 * The window Pi is told a model has when neither Pi's catalog nor the server saying so covers it:
 * the last-resort window for a local server's model.
 */
export const ENDPOINT_CONTEXT_WINDOW = 32_768

/** How long a window the server reported is reused, and how long a miss is reused. */
const LOCAL_WINDOW_TTL_MS = 5 * 60 * 1000
const LOCAL_WINDOW_MISS_TTL_MS = 60_000
/** How long a turn waits for a server to say what it was started with. */
const LOCAL_WINDOW_TIMEOUT_MS = 2_000

/**
 * The windows the servers reported for their models, keyed by `provider:model`: turns ask the
 * server on every start, and the sync reads (the window a turn is given) reuse the latest answer.
 * Miss (a null window) is cached too, briefly, so an unreachable server does not stall every turn.
 */
const localModelWindows = new Map<string, { window: number | null; at: number }>()

interface LocalModelListingEntry {
  id?: string
  aliases?: string[]
  meta?: { n_ctx?: unknown; n_context?: unknown }
  n_ctx?: unknown
  context_window?: unknown
}

function windowFromListingEntry(entry: LocalModelListingEntry | undefined): number | null {
  if (!entry) return null
  const candidates = [entry.meta?.n_ctx, entry.meta?.n_context, entry.n_ctx, entry.context_window]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return Math.floor(value)
  }
  return null
}

/** Ask a local server what window it was started with; null when it does not say. */
async function fetchLocalModelContextWindow(
  baseUrl: string,
  apiKey: string | undefined,
  modelId: string,
): Promise<number | null> {
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await undiciFetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(LOCAL_WINDOW_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: LocalModelListingEntry[] } | null
    const data = Array.isArray(body?.data) ? body.data : []
    const exact = data.find((entry) => entry?.id === modelId || entry?.aliases?.includes(modelId))
    if (exact) return windowFromListingEntry(exact)
    // A server that serves one model reports it under its own id only sometimes; accept the
    // listing's only stated window when there is exactly one.
    const stated = [
      ...new Set(data.map(windowFromListingEntry).filter((w): w is number => w !== null)),
    ]
    return stated.length === 1 ? (stated[0] ?? null) : null
  } catch {
    return null
  }
}

/** The window a local server reports for a model, reusing the last answer within its TTL. */
async function localModelContextWindow(
  providerName: string,
  modelId: string,
  baseUrl: string,
  apiKey: string | undefined,
): Promise<number | null> {
  const key = `${providerName}:${modelId}`
  const hit = localModelWindows.get(key)
  if (
    hit &&
    Date.now() - hit.at < (hit.window === null ? LOCAL_WINDOW_MISS_TTL_MS : LOCAL_WINDOW_TTL_MS)
  ) {
    return hit.window
  }
  const window = await fetchLocalModelContextWindow(baseUrl, apiKey, modelId)
  localModelWindows.set(key, { window, at: Date.now() })
  return window
}

/** Read a cached window a local server reported; null when it has not been asked yet. */
function cachedLocalModelWindow(providerName: string, modelId: string): number | null {
  const hit = localModelWindows.get(`${providerName}:${modelId}`)
  if (!hit) return null
  const ttl = hit.window === null ? LOCAL_WINDOW_MISS_TTL_MS : LOCAL_WINDOW_TTL_MS
  if (Date.now() - hit.at > ttl) {
    localModelWindows.delete(`${providerName}:${modelId}`)
    return null
  }
  return hit.window
}

/**
 * Seed the sync window cache: the worker's done frame carries the window Pi was given, and the
 * daemon's sync reads (the window a turn is given) reuse the latest answer.
 */
export function rememberLocalModelWindow(model: string, window: number): void {
  try {
    const { providerName, modelId } = parseModelString(model)
    if (!findProvider(providerName)?.local) return
    if (!Number.isFinite(window) || window <= 0) return
    localModelWindows.set(`${providerName}:${modelId}`, {
      window: Math.floor(window),
      at: Date.now(),
    })
  } catch {
    // Not a provider:model string; nothing to remember.
  }
}

/**
 * The window a turn gives Pi for `provider:model`, which compaction and each reply's room are
 * sized from: Pi's catalog for a hosted model, or the window the local server reported for a
 * local one (ENDPOINT_CONTEXT_WINDOW until it has been asked). Null for a model string that
 * names none.
 */
export function turnContextWindow(model: string): number | null {
  const parsed = (() => {
    try {
      return parseModelString(model)
    } catch {
      return null
    }
  })()
  if (!parsed) return null
  const { providerName, modelId } = parsed
  if (findProvider(providerName)?.local) {
    return cachedLocalModelWindow(providerName, modelId) ?? ENDPOINT_CONTEXT_WINDOW
  }
  return catalogContextWindow(model) ?? ENDPOINT_CONTEXT_WINDOW
}

/** A model Pi's catalog lacks, sent to an OpenAI-compatible endpoint. */
function endpointModel(
  providerName: string,
  modelId: string,
  baseUrl: string,
  contextWindow: number = ENDPOINT_CONTEXT_WINDOW,
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: piProviderName(providerName),
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 4_096,
  }
}

/** Build the runtime and resolve the model; an uncatalogued id needs an endpoint. */
export async function createPiModel(
  spec: PiModelSpec,
): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
  const { providerName, modelId, env } = spec
  const piName = piProviderName(providerName)
  const apiKey = spec.apiKey ?? providerApiKey(providerName, env)
  const credentialEnv = providerCredentialEnv(providerName, env)
  const endpoint = spec.baseUrl ?? providerEndpoint(providerName, env)

  const credentials = new InMemoryCredentialStore()
  if (apiKey || credentialEnv) {
    await credentials.modify(piName, async () =>
      piName === 'openai-codex' && apiKey
        ? {
            type: 'oauth',
            access: apiKey,
            // Bazilion refreshes the token itself (Agent.getApiKey); Pi's OAuth shape needs these.
            refresh: '',
            expires: Number.MAX_SAFE_INTEGER,
          }
        : {
            type: 'api_key',
            ...(apiKey ? { key: apiKey } : {}),
            ...(credentialEnv ? { env: credentialEnv } : {}),
          },
    )
  }
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  })

  const provider = findProvider(providerName)
  const baseUrl = endpoint ?? provider?.endpoint?.fallback
  // A local server's model is not in Pi's catalog; ask the server what window it was started
  // with (llama.cpp reports n_ctx in /models). A failed or absent answer falls back to
  // ENDPOINT_CONTEXT_WINDOW.
  const localWindow =
    provider?.local && baseUrl
      ? await localModelContextWindow(providerName, modelId, baseUrl, apiKey)
      : null
  if (provider?.local) {
    runtime.registerProvider(piName, {
      baseUrl: baseUrl ?? '',
      api: 'openai-completions',
      authHeader: provider.local.authHeader,
      apiKey: apiKey ?? provider.local.key,
      models: [
        endpointModel(providerName, modelId, baseUrl ?? '', localWindow ?? ENDPOINT_CONTEXT_WINDOW),
      ],
    })
  }

  const known = runtime.getModel(piName, modelId)
  if (known) return { runtime, model: endpoint ? { ...known, baseUrl: endpoint } : known }
  // Fatal by design: built without a base URL, the request would go to some default endpoint
  // while carrying this provider's credential.
  if (!baseUrl) {
    throw new Error(
      `Unknown model "${modelId}" for provider "${providerName}": it is not in that provider's catalog, and no endpoint is configured for it. Choose a catalogued model, or configure an endpoint for a custom one.`,
    )
  }
  return {
    runtime,
    model: endpointModel(providerName, modelId, baseUrl, localWindow ?? ENDPOINT_CONTEXT_WINDOW),
  }
}

/** The provider test: one short real request through the same runtime a turn uses. */
export async function testProviderModel(
  spec: PiModelSpec & { message: string; signal?: AbortSignal },
): Promise<ProviderTestResponse> {
  const { runtime, model } = await createPiModel(spec)
  const reply = await runtime.completeSimple(
    model,
    {
      systemPrompt: '',
      messages: [{ role: 'user', content: spec.message, timestamp: Date.now() }],
    },
    { maxTokens: 256, ...(spec.signal ? { signal: spec.signal } : {}) },
  )
  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
    throw new Error(reply.errorMessage ?? 'provider request failed')
  }
  return {
    content: reply.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    usage: { promptTokens: reply.usage.input, completionTokens: reply.usage.output },
  }
}
