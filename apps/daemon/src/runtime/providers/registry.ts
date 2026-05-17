import type { BazilionDb } from '../../core/index.ts'
import {
  hasCredentials as hasOpenAICodexCredentials,
  loadAccessToken as loadOpenAICodexAccessToken,
} from '../auth/openai-codex.ts'
import { piProvider } from './pi-adapter.ts'
import { type RetryOptions, withRetry } from './retry.ts'
import type { Provider } from './types.ts'

export interface ProviderConfig {
  anthropic?: { apiKey: string; baseURL?: string }
  openai?: { apiKey: string; baseURL?: string }
  /** ChatGPT/Codex OAuth. The apiKey is fetched+refreshed lazily from secrets. */
  openaiCodex?: { db: BazilionDb; authToken: string }
  google?: { apiKey: string; baseURL?: string }
  azureOpenai?: { apiKey: string; baseURL?: string }
  bedrock?: { apiKey?: string } // auth via AWS SDK env (AWS_PROFILE / AWS_ACCESS_KEY_ID / ...)
  googleVertex?: Record<string, never> // auth via ADC + GOOGLE_CLOUD_PROJECT
  mistral?: { apiKey: string; baseURL?: string }
  groq?: { apiKey: string; baseURL?: string }
  cerebras?: { apiKey: string; baseURL?: string }
  xai?: { apiKey: string; baseURL?: string }
  zai?: { apiKey: string; baseURL?: string }
  huggingface?: { apiKey: string; baseURL?: string }
  openrouter?: { apiKey: string; baseURL?: string }
  vercelAiGateway?: { apiKey: string; baseURL?: string }
  lmstudio?: { baseURL?: string; apiKey?: string }
  ollama?: { baseURL?: string; apiKey?: string }
}

export interface ResolvedModel {
  provider: Provider
  model: string
}

/**
 * Env var → provider config. Empty / missing vars leave that provider unconfigured.
 *
 * Pass `oauth` (the daemon's `{db, authToken}` pair) to also pick up
 * OAuth-backed providers whose credentials live in the `secrets` table
 * (currently: `openai-codex` / ChatGPT). Env-only callers can omit it —
 * those providers just won't be configured.
 */
export function loadProviderConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  oauth?: { db: BazilionDb; authToken: string },
): ProviderConfig {
  const config: ProviderConfig = {
    lmstudio: {
      ...(env.LMSTUDIO_URL !== undefined ? { baseURL: env.LMSTUDIO_URL } : {}),
      ...(env.LMSTUDIO_API_KEY !== undefined ? { apiKey: env.LMSTUDIO_API_KEY } : {}),
    },
    ollama: {
      ...(env.OLLAMA_URL !== undefined ? { baseURL: env.OLLAMA_URL } : {}),
      ...(env.OLLAMA_API_KEY !== undefined ? { apiKey: env.OLLAMA_API_KEY } : {}),
    },
  }
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_OAUTH_TOKEN) {
    config.anthropic = { apiKey: env.ANTHROPIC_OAUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '' }
  }
  if (env.OPENAI_API_KEY) config.openai = { apiKey: env.OPENAI_API_KEY }
  if (env.GEMINI_API_KEY) config.google = { apiKey: env.GEMINI_API_KEY }
  if (env.AZURE_OPENAI_API_KEY) config.azureOpenai = { apiKey: env.AZURE_OPENAI_API_KEY }
  if (
    env.AWS_PROFILE ||
    env.AWS_BEARER_TOKEN_BEDROCK ||
    (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
  ) {
    config.bedrock = {}
  }
  if (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_LOCATION) {
    config.googleVertex = {}
  }
  if (env.MISTRAL_API_KEY) config.mistral = { apiKey: env.MISTRAL_API_KEY }
  if (env.GROQ_API_KEY) config.groq = { apiKey: env.GROQ_API_KEY }
  if (env.CEREBRAS_API_KEY) config.cerebras = { apiKey: env.CEREBRAS_API_KEY }
  if (env.XAI_API_KEY) config.xai = { apiKey: env.XAI_API_KEY }
  if (env.ZAI_API_KEY) config.zai = { apiKey: env.ZAI_API_KEY }
  if (env.HF_TOKEN) config.huggingface = { apiKey: env.HF_TOKEN }
  if (env.OPENROUTER_API_KEY) config.openrouter = { apiKey: env.OPENROUTER_API_KEY }
  if (env.AI_GATEWAY_API_KEY) config.vercelAiGateway = { apiKey: env.AI_GATEWAY_API_KEY }
  if (oauth && hasOpenAICodexCredentials(oauth.db, oauth.authToken)) {
    config.openaiCodex = oauth
  }
  return config
}

export interface ProviderRegistry {
  resolve(modelString: string): ResolvedModel
  list(): string[]
}

export interface ProviderRegistryOptions {
  /** If provided, resolve() refuses any provider not in the set with "disabled by admin". */
  enabledSet?: ReadonlySet<string>
  /** Retry policy applied uniformly to every provider; omit for built-in defaults. */
  retry?: RetryOptions
}

interface ProviderEntry {
  configured: (c: ProviderConfig) => boolean
  build: (c: ProviderConfig) => Provider
  /** Helpful error hint when the caller references this provider but env isn't set. */
  hint: string
}

const PROVIDERS: Record<string, ProviderEntry> = {
  anthropic: {
    configured: (c) => !!c.anthropic,
    build: (c) =>
      piProvider({
        providerName: 'anthropic',
        fallbackApi: 'anthropic-messages',
        apiKey: c.anthropic?.apiKey,
        baseUrl: c.anthropic?.baseURL,
      }),
    hint: 'ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN',
  },
  openai: {
    configured: (c) => !!c.openai,
    build: (c) =>
      piProvider({
        providerName: 'openai',
        fallbackApi: 'openai-completions',
        apiKey: c.openai?.apiKey,
        baseUrl: c.openai?.baseURL,
      }),
    hint: 'OPENAI_API_KEY',
  },
  'openai-codex': {
    configured: (c) => !!c.openaiCodex,
    // Pi-ai's `openai-codex-responses` speaks the ChatGPT backend's Responses
    // API (https://chatgpt.com/backend-api) using a JWT access token as the
    // apiKey. We pass a supplier that refreshes lazily via the OAuth refresh
    // token, so the registry-cached Provider instance stays valid across
    // expiries without rebuild.
    build: (c) => {
      const openaiCodex = c.openaiCodex
      if (!openaiCodex) throw new Error('openai-codex not configured')
      return piProvider({
        providerName: 'openai-codex',
        fallbackApi: 'openai-codex-responses',
        apiKey: () => loadOpenAICodexAccessToken(openaiCodex.db, openaiCodex.authToken),
      })
    },
    hint: 'run `bazilion auth openai login` (or click Connect on /config)',
  },
  google: {
    configured: (c) => !!c.google,
    build: (c) =>
      piProvider({
        providerName: 'google',
        fallbackApi: 'google-generative-ai',
        apiKey: c.google?.apiKey,
        baseUrl: c.google?.baseURL,
      }),
    hint: 'GEMINI_API_KEY',
  },
  'google-vertex': {
    configured: (c) => !!c.googleVertex,
    build: () => piProvider({ providerName: 'google-vertex', fallbackApi: 'google-vertex' }),
    hint: 'GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION + ADC (gcloud auth)',
  },
  'azure-openai': {
    configured: (c) => !!c.azureOpenai,
    build: (c) =>
      piProvider({
        providerName: 'azure-openai',
        fallbackApi: 'azure-openai-responses',
        apiKey: c.azureOpenai?.apiKey,
        baseUrl: c.azureOpenai?.baseURL,
      }),
    hint: 'AZURE_OPENAI_API_KEY',
  },
  bedrock: {
    configured: (c) => !!c.bedrock,
    build: () =>
      piProvider({
        providerName: 'bedrock',
        piProviderName: 'amazon-bedrock',
        fallbackApi: 'bedrock-converse-stream',
      }),
    hint: 'AWS_PROFILE or AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY',
  },
  mistral: {
    configured: (c) => !!c.mistral,
    build: (c) =>
      piProvider({
        providerName: 'mistral',
        fallbackApi: 'openai-completions',
        apiKey: c.mistral?.apiKey,
        baseUrl: c.mistral?.baseURL,
      }),
    hint: 'MISTRAL_API_KEY',
  },
  groq: {
    configured: (c) => !!c.groq,
    build: (c) =>
      piProvider({
        providerName: 'groq',
        fallbackApi: 'openai-completions',
        apiKey: c.groq?.apiKey,
        baseUrl: c.groq?.baseURL,
      }),
    hint: 'GROQ_API_KEY',
  },
  cerebras: {
    configured: (c) => !!c.cerebras,
    build: (c) =>
      piProvider({
        providerName: 'cerebras',
        fallbackApi: 'openai-completions',
        apiKey: c.cerebras?.apiKey,
        baseUrl: c.cerebras?.baseURL,
      }),
    hint: 'CEREBRAS_API_KEY',
  },
  xai: {
    configured: (c) => !!c.xai,
    build: (c) =>
      piProvider({
        providerName: 'xai',
        fallbackApi: 'openai-completions',
        apiKey: c.xai?.apiKey,
        baseUrl: c.xai?.baseURL,
      }),
    hint: 'XAI_API_KEY',
  },
  zai: {
    configured: (c) => !!c.zai,
    build: (c) =>
      piProvider({
        providerName: 'zai',
        fallbackApi: 'openai-completions',
        apiKey: c.zai?.apiKey,
        baseUrl: c.zai?.baseURL,
      }),
    hint: 'ZAI_API_KEY',
  },
  huggingface: {
    configured: (c) => !!c.huggingface,
    build: (c) =>
      piProvider({
        providerName: 'huggingface',
        fallbackApi: 'openai-completions',
        apiKey: c.huggingface?.apiKey,
        baseUrl: c.huggingface?.baseURL,
      }),
    hint: 'HF_TOKEN',
  },
  openrouter: {
    configured: (c) => !!c.openrouter,
    build: (c) =>
      piProvider({
        providerName: 'openrouter',
        fallbackApi: 'openai-completions',
        apiKey: c.openrouter?.apiKey,
        baseUrl: c.openrouter?.baseURL,
      }),
    hint: 'OPENROUTER_API_KEY',
  },
  'vercel-ai-gateway': {
    configured: (c) => !!c.vercelAiGateway,
    build: (c) =>
      piProvider({
        providerName: 'vercel-ai-gateway',
        fallbackApi: 'openai-completions',
        apiKey: c.vercelAiGateway?.apiKey,
        baseUrl: c.vercelAiGateway?.baseURL,
      }),
    hint: 'AI_GATEWAY_API_KEY',
  },
  lmstudio: {
    configured: () => true,
    build: (c) =>
      piProvider({
        providerName: 'lmstudio',
        fallbackApi: 'openai-completions',
        apiKey: c.lmstudio?.apiKey ?? 'lm-studio',
        baseUrl: c.lmstudio?.baseURL ?? 'http://127.0.0.1:1234/v1',
      }),
    hint: 'LMSTUDIO_URL (default http://127.0.0.1:1234/v1)',
  },
  ollama: {
    configured: () => true,
    build: (c) =>
      piProvider({
        providerName: 'ollama',
        fallbackApi: 'openai-completions',
        apiKey: c.ollama?.apiKey ?? 'ollama',
        baseUrl: c.ollama?.baseURL ?? 'http://127.0.0.1:11434/v1',
      }),
    hint: 'OLLAMA_URL (default http://127.0.0.1:11434/v1)',
  },
}

/**
 * Model strings are `provider:model`, e.g.:
 *   - `anthropic:claude-opus-4-6`
 *   - `openai:gpt-4o`
 *   - `google:gemini-2.0-flash-exp`
 *   - `groq:llama-3.3-70b-versatile`
 *   - `lmstudio:my-loaded-model`
 *   - `ollama:llama2`
 */
export function createProviderRegistry(
  config: ProviderConfig,
  opts: ProviderRegistryOptions = {},
): ProviderRegistry {
  const cache = new Map<string, Provider>()
  const enabledSet = opts.enabledSet

  function get(name: string): Provider {
    const cached = cache.get(name)
    if (cached) return cached
    const entry = PROVIDERS[name]
    if (!entry) throw new Error(`unknown provider: ${name}`)
    if (enabledSet && !enabledSet.has(name)) {
      throw new Error(`${name} provider is disabled — enable it on the /config page`)
    }
    if (!entry.configured(config)) {
      throw new Error(`${name} provider not configured (set ${entry.hint})`)
    }
    const raw = entry.build(config)
    const provider = withRetry(raw, {
      ...(opts.retry ?? {}),
      onRetry: (info) => {
        opts.retry?.onRetry?.(info)
        console.warn(
          `[provider/${name}] transient error on attempt ${info.attempt}, retrying in ${info.delayMs}ms: ${info.error.message.slice(0, 160)}`,
        )
      },
    })
    cache.set(name, provider)
    return provider
  }

  return {
    resolve(modelString: string): ResolvedModel {
      const idx = modelString.indexOf(':')
      if (idx === -1) {
        throw new Error(`invalid model string "${modelString}": expected "provider:model"`)
      }
      const providerName = modelString.slice(0, idx)
      const model = modelString.slice(idx + 1)
      return { provider: get(providerName), model }
    },
    list() {
      return Object.entries(PROVIDERS)
        .filter(([name, entry]) => {
          if (!entry.configured(config)) return false
          if (enabledSet && !enabledSet.has(name)) return false
          return true
        })
        .map(([name]) => name)
    },
  }
}

export interface ProviderMeta {
  name: string
  enabled: boolean
  /** Hint shown when the provider isn't configured — the env var(s) required. */
  envHint: string
}

/** List every provider the registry knows about, plus whether each is configured. */
export function listAllProviders(config: ProviderConfig): ProviderMeta[] {
  return Object.entries(PROVIDERS).map(([name, entry]) => ({
    name,
    enabled: entry.configured(config),
    envHint: entry.hint,
  }))
}
