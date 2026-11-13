// BAZILION_IMAGE_MODEL selects image generation: off, or one image model through one account.

import { parseModelString } from './providers.ts'

export const IMAGE_MODEL_CHOICES = [
  'off',
  'openai-codex:gpt-image-2',
  'openai:gpt-image-2',
  'openrouter:google/gemini-3.1-flash-image',
  'openrouter:openai/gpt-image-2',
] as const

export type ImageRoute =
  | {
      ready: true
      /** The selected choice, e.g. `openai:gpt-image-2`. */
      model: string
      provider: 'openai-codex' | 'openai' | 'openrouter'
      modelId: string
      /** OpenAI or OpenRouter key; the ChatGPT login token is fetched per request. */
      apiKey?: string
    }
  | { ready: false; reason: string }

export function imageRoute(env: NodeJS.ProcessEnv, codexConnected: boolean): ImageRoute {
  const model = env.BAZILION_IMAGE_MODEL || 'off'
  if (model === 'off') return { ready: false, reason: 'Image generation is off.' }
  if (!(IMAGE_MODEL_CHOICES as readonly string[]).includes(model))
    return { ready: false, reason: `Unknown image model "${model}".` }
  const { providerName, modelId } = parseModelString(model)
  const provider = providerName as 'openai-codex' | 'openai' | 'openrouter'
  if (provider === 'openai-codex')
    return codexConnected
      ? { ready: true, model, provider, modelId }
      : {
          ready: false,
          reason: `${model} needs a ChatGPT login: connect ChatGPT on /config or run bazilion auth openai login.`,
        }
  const key = provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'
  const apiKey = env[key]?.trim()
  return apiKey
    ? { ready: true, model, provider, modelId, apiKey }
    : { ready: false, reason: `${model} needs ${key}.` }
}
