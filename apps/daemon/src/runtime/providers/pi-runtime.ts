// Pi model runtime for one provider:model, with credentials held in memory only: Pi never reads
// or writes its own auth or model files, and never fetches catalogs from the network.

import type { ProviderTestResponse } from '@bazilion/api-types'
import type { Api, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { fetch as undiciFetch } from 'undici'
import {
  findProvider,
  type LocalWindowSource,
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
  /**
   * The context window set by hand (Setup → Models), for a model whose window neither Pi's catalog
   * nor its server says.
   */
  contextWindow?: number
}

/** How long a turn waits for a local server to say what window it loaded a model with. */
const LOCAL_WINDOW_TIMEOUT_MS = 2_000
/** How long the daemon reuses a server's answer before asking again, and a server's silence. */
const LOCAL_WINDOW_TTL_MS = 5 * 60 * 1000
const LOCAL_WINDOW_MISS_TTL_MS = 60_000

/** What local servers last answered, by `provider:model`; null when they did not say. */
const serverWindows = new Map<string, { window: number | null; at: number }>()
/** The window each local model's latest turn was given, as the worker reported it. */
const turnWindows = new Map<string, number>()

function positive(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

/** The server's own API root: its OpenAI-compatible address without the trailing `/v1`. */
function serverRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

async function getJson(url: string, apiKey: string | undefined): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const res = await undiciFetch(url, {
    headers,
    signal: AbortSignal.timeout(LOCAL_WINDOW_TIMEOUT_MS),
  })
  return res.ok ? await res.json() : null
}

interface LlamaCppListingEntry {
  id?: string
  aliases?: string[]
  meta?: { n_ctx?: unknown; n_context?: unknown }
  n_ctx?: unknown
  context_window?: unknown
}

function llamaCppEntryWindow(entry: LlamaCppListingEntry | undefined): number | null {
  if (!entry) return null
  const candidates = [entry.meta?.n_ctx, entry.meta?.n_context, entry.n_ctx, entry.context_window]
  for (const candidate of candidates) {
    const window = positive(candidate)
    if (window) return window
  }
  return null
}

/** llama.cpp: `meta.n_ctx` in its model listing, the window each request gets. */
function llamaCppWindow(body: unknown, modelId: string): number | null {
  const data = (body as { data?: LlamaCppListingEntry[] } | null)?.data
  if (!Array.isArray(data)) return null
  const exact = data.find((entry) => entry?.id === modelId || entry?.aliases?.includes(modelId))
  if (exact) return llamaCppEntryWindow(exact)
  // A server that serves one model reports it under its own id only sometimes; accept the
  // listing's only stated window when there is exactly one.
  const stated = [...new Set(data.map(llamaCppEntryWindow).filter((w): w is number => w !== null))]
  return stated.length === 1 ? (stated[0] ?? null) : null
}

interface LmStudioModel {
  key?: string
  loaded_instances?: Array<{ id?: string; config?: { context_length?: unknown } }>
}

/** LM Studio: the context length an instance of the model is loaded with. */
function lmStudioWindow(body: unknown, modelId: string): number | null {
  const models = (body as { models?: LmStudioModel[] } | null)?.models
  if (!Array.isArray(models)) return null
  for (const model of models) {
    const instances = model?.loaded_instances ?? []
    const instance =
      instances.find((candidate) => candidate?.id === modelId) ??
      (model?.key === modelId ? instances[0] : undefined)
    if (instance) return positive(instance.config?.context_length)
  }
  return null
}

/** An Ollama name with its tag: `qwen3` is `qwen3:latest`. */
function ollamaTagged(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : `${name}:latest`
}

/** Ollama: the context length of the running model. */
function ollamaWindow(body: unknown, modelId: string): number | null {
  const models = (
    body as { models?: Array<{ name?: string; model?: string; context_length?: unknown }> } | null
  )?.models
  if (!Array.isArray(models)) return null
  const wanted = ollamaTagged(modelId)
  const running = models.find(
    (model) =>
      (model?.name && ollamaTagged(model.name) === wanted) ||
      (model?.model && ollamaTagged(model.model) === wanted),
  )
  return running ? positive(running.context_length) : null
}

/** Ask a local server what window it loaded a model with; null when it does not say. */
async function askServerWindow(
  source: LocalWindowSource,
  baseUrl: string,
  apiKey: string | undefined,
  modelId: string,
): Promise<number | null> {
  try {
    if (source === 'llamacpp') {
      return llamaCppWindow(await getJson(`${baseUrl.replace(/\/+$/, '')}/models`, apiKey), modelId)
    }
    if (source === 'lmstudio') {
      return lmStudioWindow(await getJson(`${serverRoot(baseUrl)}/api/v1/models`, apiKey), modelId)
    }
    return ollamaWindow(await getJson(`${serverRoot(baseUrl)}/api/ps`, apiKey), modelId)
  } catch {
    return null
  }
}

/**
 * The window a local server reports for a model. A turn asks every time (`fresh`); the daemon's
 * Models page reuses an answer for a while, and a silence for less.
 */
export async function serverContextWindow(
  providerName: string,
  modelId: string,
  env: Readonly<Record<string, string | undefined>>,
  options: { fresh?: boolean } = {},
): Promise<number | null> {
  const source = findProvider(providerName)?.local?.window
  const baseUrl =
    providerEndpoint(providerName, env) ?? findProvider(providerName)?.endpoint?.fallback
  if (!source || !baseUrl) return null
  const key = `${providerName}:${modelId}`
  const hit = serverWindows.get(key)
  const ttl = hit?.window === null ? LOCAL_WINDOW_MISS_TTL_MS : LOCAL_WINDOW_TTL_MS
  if (!options.fresh && hit && Date.now() - hit.at < ttl) return hit.window
  const window = await askServerWindow(source, baseUrl, providerApiKey(providerName, env), modelId)
  serverWindows.set(key, { window, at: Date.now() })
  return window
}

/**
 * Remember the window a local model's turn was given: the worker reports it on its done frame,
 * and the daemon's own reads of the window (the meter, chat-context) show it.
 */
export function rememberLocalModelWindow(model: string, window: number): void {
  try {
    const { providerName } = parseModelString(model)
    if (!findProvider(providerName)?.local) return
    const tokens = positive(window)
    if (tokens) turnWindows.set(model, tokens)
  } catch {
    // Not a provider:model string; nothing to remember.
  }
}

/**
 * The window the daemon shows for `provider:model`: Pi's catalog's for a hosted model; for a
 * local one, the window its latest turn was given, or what its server last said; otherwise the
 * one set by hand (`setting`). Null when nothing says it: a turn on it is refused.
 */
export function turnContextWindow(model: string, setting: number | null): number | null {
  let providerName: string
  try {
    providerName = parseModelString(model).providerName
  } catch {
    return null
  }
  if (findProvider(providerName)?.local) {
    return turnWindows.get(model) ?? serverWindows.get(model)?.window ?? setting
  }
  return catalogContextWindow(model) ?? setting
}

/** Why a turn cannot run on a model: nothing says its context window. */
function unknownWindowError(providerName: string, modelId: string, local: boolean): Error {
  const provider = findProvider(providerName)
  const model = `${providerName}:${modelId}`
  const why = !local
    ? `${modelId} is not in ${provider?.displayName ?? providerName}'s catalog, so its context window is unknown`
    : provider?.local?.window === 'llamacpp'
      ? `${provider.displayName} did not say the context window it was started with`
      : `${provider?.displayName ?? providerName} did not say the context window of ${modelId} (it does once the model is loaded)`
  return new Error(
    `${why}, and none is set for it. Set it in Setup → Models, or run \`bazilion provider window ${model} <tokens>\`.`,
  )
}

/**
 * A model Pi's catalog lacks, sent to an OpenAI-compatible endpoint. Its reply may use whatever
 * the window leaves (Pi fits each reply's limit into it). `window` is null only for the provider
 * test, whose one short request does not depend on it.
 */
function endpointModel(
  providerName: string,
  modelId: string,
  baseUrl: string,
  window: number | null,
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
    // 0 is Pi's unknown: it then keeps the request's own reply limit.
    contextWindow: window ?? 0,
    maxTokens: window ?? 0,
  }
}

/**
 * Build the runtime and resolve the model; an uncatalogued id needs an endpoint. A turn needs the
 * model's context window: Pi's catalog, the local server or the value set by hand says it, or the
 * turn is refused. The provider test (`window: 'not needed'`) sends one short request without it.
 */
export async function createPiModel(
  spec: PiModelSpec,
  options: { window?: 'needed' | 'not needed' } = {},
): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
  const { providerName, modelId, env } = spec
  const needsWindow = options.window !== 'not needed'
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
  if (provider?.local) {
    // A local server's model is not in Pi's catalog: the server says the window it loaded the
    // model with, or the value set by hand does.
    const window =
      (needsWindow && baseUrl
        ? await askServerWindow(provider.local.window, baseUrl, apiKey, modelId)
        : null) ??
      spec.contextWindow ??
      null
    if (!window && needsWindow) throw unknownWindowError(providerName, modelId, true)
    const model = endpointModel(providerName, modelId, baseUrl ?? '', window)
    runtime.registerProvider(piName, {
      baseUrl: baseUrl ?? '',
      api: 'openai-completions',
      authHeader: provider.local.authHeader,
      apiKey: apiKey ?? provider.local.key,
      // Pi refuses a registered window of 0: the provider test's model, whose window is unknown,
      // goes to the provider's address unregistered.
      models: window ? [model] : [],
    })
    if (!window) return { runtime, model }
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
  const window = spec.contextWindow ?? null
  if (!window && needsWindow) throw unknownWindowError(providerName, modelId, false)
  return { runtime, model: endpointModel(providerName, modelId, baseUrl, window) }
}

/** The provider test: one short real request through the same runtime a turn uses. */
export async function testProviderModel(
  spec: PiModelSpec & { message: string; signal?: AbortSignal },
): Promise<ProviderTestResponse> {
  const { runtime, model } = await createPiModel(spec, { window: 'not needed' })
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
