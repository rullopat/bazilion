/** Curated image routes. Automatic selection follows enabled OpenAI text providers, never errors. */
export const OPENROUTER_IMAGE_MODELS = [
  'google/gemini-3.1-flash-image',
  'openai/gpt-image-2',
] as const
export const IMAGE_MODELS = [
  ...OPENROUTER_IMAGE_MODELS,
  'openai:gpt-image-2',
  'openai-codex:gpt-image-2',
] as const
export const IMAGE_MODEL_CHOICES = ['auto', ...IMAGE_MODELS] as const
export type ImageModelId = (typeof IMAGE_MODELS)[number]
export interface ImageTextContext {
  enabledProviders: ReadonlySet<string>
  /** The admitted turn's text model, supplied by the daemon, not by the image tool. */
  chatModel?: string
}
export type ImageProvider = 'openrouter' | 'openai' | 'openai-codex'

/** Image-only credentials are not added to worker/MCP envs. Selected chat auth stays separate. */
export function imageTurnEnv(env: NodeJS.ProcessEnv, chatModel: string): NodeJS.ProcessEnv {
  const copy = { ...env }
  if (!chatModel.startsWith('openrouter:')) delete copy.OPENROUTER_API_KEY
  if (!chatModel.startsWith('openai:')) delete copy.OPENAI_API_KEY
  return copy
}

export function imageGenerationConfig(
  env: NodeJS.ProcessEnv,
  codexConnected = false,
  text?: ImageTextContext,
):
  | { ready: true; model: ImageModelId; provider: ImageProvider; apiKey?: string; status: string }
  | { ready: false; status: string } {
  if (env.BAZILION_IMAGE_GENERATION !== 'on') {
    return { ready: false, status: 'Image generation is off.' }
  }
  let model = env.BAZILION_IMAGE_MODEL || 'auto'
  const automatic = model === 'auto'
  if (automatic) {
    const enabled = (['openai', 'openai-codex'] as const).filter((id) =>
      text?.enabledProviders.has(id),
    )
    const chatProvider = text?.chatModel?.split(':')[0]
    let provider: 'openai' | 'openai-codex'
    if (chatProvider === 'openai' || chatProvider === 'openai-codex') {
      if (!enabled.includes(chatProvider)) {
        return {
          ready: false,
          status:
            'Automatic images require the Agent’s OpenAI/ChatGPT text provider to be enabled. No switch to another billing route.',
        }
      }
      provider = chatProvider
    } else if (enabled.length === 1 && enabled[0]) {
      provider = enabled[0]
    } else {
      return {
        ready: false,
        status:
          enabled.length === 0
            ? 'Automatic images: enable OpenAI API key or ChatGPT/Codex for text first. Stored credentials alone do not enable a route; OpenRouter requires an explicit image choice.'
            : 'Automatic images: both OpenAI text providers are enabled. OpenAI/ChatGPT Agents follow their own text provider; other Agents require an explicit image route. No credential fallback.',
      }
    }
    model = `${provider}:gpt-image-2`
  }
  const selectionNote = automatic
    ? ' Automatic selection follows enabled text providers, never provider failures.'
    : ''
  if (!IMAGE_MODELS.some((id) => id === model)) {
    return { ready: false, status: 'Select a supported image model before generating images.' }
  }
  if (model === 'openai-codex:gpt-image-2') {
    return codexConnected
      ? {
          ready: true,
          model,
          provider: 'openai-codex',
          status:
            'Ready: gpt-image-2 via ChatGPT/Codex login (subscription limits apply; image entitlement is not yet tested). No API-key fallback.' +
            selectionNote,
        }
      : {
          ready: false,
          status:
            'Connect ChatGPT on /config or run bazilion auth openai login. Image access depends on your account; no API-key fallback.',
        }
  }
  const provider = model === 'openai:gpt-image-2' ? 'openai' : 'openrouter'
  const key = provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'
  const apiKey = env[key]?.trim()
  if (!apiKey)
    return {
      ready: false,
      status: `Set ${key} in the ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} provider settings. No credential fallback.`,
    }
  return {
    ready: true,
    model: model as ImageModelId,
    provider,
    apiKey,
    status: `Ready: ${model} via ${provider === 'openai' ? 'OpenAI API key' : 'OpenRouter'} (paid API requests; account access is not yet tested).${selectionNote}`,
  }
}
