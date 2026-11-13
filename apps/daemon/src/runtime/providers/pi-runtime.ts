// Pi model runtime for one provider:model, with credentials held in memory only: Pi never reads
// or writes its own auth or model files, and never fetches catalogs from the network.

import type { ProviderTestResponse } from '@bazilion/api-types'
import type { Api, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import {
  findProvider,
  piProviderName,
  providerApiKey,
  providerCredentialEnv,
  providerEndpoint,
} from '../../core/providers.ts'

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

/** A model Pi's catalog lacks, sent to an OpenAI-compatible endpoint. */
function endpointModel(providerName: string, modelId: string, baseUrl: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: piProviderName(providerName),
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
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
  if (provider?.local) {
    const baseUrl = endpoint ?? provider.endpoint?.fallback ?? ''
    runtime.registerProvider(piName, {
      baseUrl,
      api: 'openai-completions',
      authHeader: provider.local.authHeader,
      apiKey: apiKey ?? provider.local.key,
      models: [endpointModel(providerName, modelId, baseUrl)],
    })
  }

  const known = runtime.getModel(piName, modelId)
  if (known) return { runtime, model: endpoint ? { ...known, baseUrl: endpoint } : known }
  const fallback = endpoint ?? provider?.endpoint?.fallback
  // Fatal by design: built without a base URL, the request would go to some default endpoint
  // while carrying this provider's credential.
  if (!fallback) {
    throw new Error(
      `Unknown model "${modelId}" for provider "${providerName}": it is not in that provider's catalog, and no endpoint is configured for it. Choose a catalogued model, or configure an endpoint for a custom one.`,
    )
  }
  return { runtime, model: endpointModel(providerName, modelId, fallback) }
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
