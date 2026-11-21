// BAZILION_IMAGE_MODEL selects image generation: off, or one image model through one account.

import { parseModelString } from './providers.ts'

/** Every way to generate images: a model, the provider whose account it runs on, who pays. */
export const IMAGE_ROUTES = [
  {
    id: 'openai-codex:gpt-image-2',
    model: 'GPT Image 2',
    provider: 'openai-codex',
    label: 'GPT Image 2 · ChatGPT sign-in',
    billing: 'Uses your ChatGPT subscription',
  },
  {
    id: 'openai:gpt-image-2',
    model: 'GPT Image 2',
    provider: 'openai',
    label: 'GPT Image 2 · OpenAI API key',
    billing: 'Billed per image by OpenAI',
  },
  {
    id: 'openrouter:google/gemini-3.1-flash-image',
    model: 'Gemini 3.1 Flash Image',
    provider: 'openrouter',
    label: 'Gemini 3.1 Flash Image · OpenRouter',
    billing: 'Billed by OpenRouter',
  },
  {
    id: 'openrouter:openai/gpt-image-2',
    model: 'GPT Image 2',
    provider: 'openrouter',
    label: 'GPT Image 2 · OpenRouter',
    billing: 'Billed by OpenRouter',
  },
] as const

export type ImageRouteDef = (typeof IMAGE_ROUTES)[number]

export const IMAGE_MODEL_CHOICES: readonly string[] = ['off', ...IMAGE_ROUTES.map(({ id }) => id)]

/** Image models are chosen under Images, never as chat models. */
export function isImageModel(provider: string, model: string): boolean {
  return IMAGE_ROUTES.some((route) => route.id === `${provider}:${model}`)
}

const ROUTE_KEY = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const

/** What a route still needs before it can draw, in a few words; null when it is ready. */
export function imageRouteNeeds(
  route: ImageRouteDef,
  env: NodeJS.ProcessEnv,
  codexConnected: boolean,
): string | null {
  if (route.provider === 'openai-codex') return codexConnected ? null : 'a ChatGPT sign-in'
  if (env[ROUTE_KEY[route.provider]]?.trim()) return null
  return route.provider === 'openai' ? 'an OpenAI API key' : 'an OpenRouter API key'
}

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
  const route = IMAGE_ROUTES.find(({ id }) => id === model)
  if (!route) return { ready: false, reason: `Unknown image model "${model}".` }
  const { modelId } = parseModelString(model)
  const provider = route.provider
  if (provider === 'openai-codex')
    return codexConnected
      ? { ready: true, model, provider, modelId }
      : {
          ready: false,
          reason: `${model} needs a ChatGPT login: sign in under Setup, Models, or run bazilion auth openai login.`,
        }
  const key = ROUTE_KEY[provider]
  const apiKey = env[key]?.trim()
  return apiKey
    ? { ready: true, model, provider, modelId, apiKey }
    : { ready: false, reason: `${model} needs ${key}.` }
}
