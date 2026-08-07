import type { BazilionDb } from '../../core/index.ts'
import {
  hasCredentials as hasOpenAICodexCredentials,
  loadAccessToken as loadOpenAICodexAccessToken,
} from '../auth/openai-codex.ts'
import { piProvider } from './pi-adapter.ts'
import { type RetryOptions, withRetry } from './retry.ts'
import type { Provider } from './types.ts'

export interface ProviderConfig {
  /** Full merged daemon environment for providers with multi-field/ambient auth. */
  env?: NodeJS.ProcessEnv
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
  // Providers added in pi-ai 0.70–0.75.
  deepseek?: { apiKey: string; baseURL?: string }
  fireworks?: { apiKey: string; baseURL?: string }
  together?: { apiKey: string; baseURL?: string }
  moonshotai?: { apiKey: string; baseURL?: string }
  moonshotaiCn?: { apiKey: string; baseURL?: string }
  kimiCoding?: { apiKey: string; baseURL?: string }
  minimax?: { apiKey: string; baseURL?: string }
  minimaxCn?: { apiKey: string; baseURL?: string }
  qwenTokenPlan?: { apiKey: string; baseURL?: string }
  qwenTokenPlanCn?: { apiKey: string; baseURL?: string }
  xiaomi?: { apiKey: string; baseURL?: string }
  xiaomiTokenPlanAms?: { apiKey: string; baseURL?: string }
  xiaomiTokenPlanCn?: { apiKey: string; baseURL?: string }
  xiaomiTokenPlanSgp?: { apiKey: string; baseURL?: string }
  antLing?: { apiKey: string; baseURL?: string }
  nvidia?: { apiKey: string; baseURL?: string }
  opencode?: { apiKey: string; baseURL?: string }
  opencodeGo?: { apiKey: string; baseURL?: string }
  zaiCodingCn?: { apiKey: string; baseURL?: string }
  githubCopilot?: { apiKey: string }
  cloudflareAiGateway?: { apiKey: string; accountId?: string; gatewayId?: string }
  cloudflareWorkersAi?: { apiKey: string; accountId?: string }
  lmstudio?: { baseURL?: string; apiKey?: string }
  ollama?: { baseURL?: string; apiKey?: string }
  llamacpp?: { baseURL?: string; apiKey?: string }
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
    env,
    lmstudio: {
      ...(env.LMSTUDIO_URL !== undefined ? { baseURL: env.LMSTUDIO_URL } : {}),
      ...(env.LMSTUDIO_API_KEY !== undefined ? { apiKey: env.LMSTUDIO_API_KEY } : {}),
    },
    ollama: {
      ...(env.OLLAMA_URL !== undefined ? { baseURL: env.OLLAMA_URL } : {}),
      ...(env.OLLAMA_API_KEY !== undefined ? { apiKey: env.OLLAMA_API_KEY } : {}),
    },
    llamacpp: {
      ...(env.LLAMACPP_URL !== undefined ? { baseURL: env.LLAMACPP_URL } : {}),
      ...(env.LLAMACPP_API_KEY !== undefined ? { apiKey: env.LLAMACPP_API_KEY } : {}),
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
  if (env.DEEPSEEK_API_KEY) config.deepseek = { apiKey: env.DEEPSEEK_API_KEY }
  if (env.FIREWORKS_API_KEY) config.fireworks = { apiKey: env.FIREWORKS_API_KEY }
  if (env.TOGETHER_API_KEY) config.together = { apiKey: env.TOGETHER_API_KEY }
  if (env.MOONSHOT_API_KEY) config.moonshotai = { apiKey: env.MOONSHOT_API_KEY }
  if (env.MOONSHOT_CN_API_KEY) config.moonshotaiCn = { apiKey: env.MOONSHOT_CN_API_KEY }
  if (env.KIMI_API_KEY) config.kimiCoding = { apiKey: env.KIMI_API_KEY }
  if (env.MINIMAX_API_KEY) config.minimax = { apiKey: env.MINIMAX_API_KEY }
  if (env.MINIMAX_CN_API_KEY) config.minimaxCn = { apiKey: env.MINIMAX_CN_API_KEY }
  if (env.QWEN_TOKEN_PLAN_API_KEY) {
    config.qwenTokenPlan = { apiKey: env.QWEN_TOKEN_PLAN_API_KEY }
  }
  if (env.QWEN_TOKEN_PLAN_CN_API_KEY) {
    config.qwenTokenPlanCn = { apiKey: env.QWEN_TOKEN_PLAN_CN_API_KEY }
  }
  if (env.XIAOMI_API_KEY) config.xiaomi = { apiKey: env.XIAOMI_API_KEY }
  if (env.XIAOMI_TOKEN_PLAN_AMS_API_KEY) {
    config.xiaomiTokenPlanAms = { apiKey: env.XIAOMI_TOKEN_PLAN_AMS_API_KEY }
  }
  if (env.XIAOMI_TOKEN_PLAN_CN_API_KEY) {
    config.xiaomiTokenPlanCn = { apiKey: env.XIAOMI_TOKEN_PLAN_CN_API_KEY }
  }
  if (env.XIAOMI_TOKEN_PLAN_SGP_API_KEY) {
    config.xiaomiTokenPlanSgp = { apiKey: env.XIAOMI_TOKEN_PLAN_SGP_API_KEY }
  }
  if (env.ANT_LING_API_KEY) config.antLing = { apiKey: env.ANT_LING_API_KEY }
  if (env.NVIDIA_API_KEY) config.nvidia = { apiKey: env.NVIDIA_API_KEY }
  if (env.OPENCODE_API_KEY) config.opencode = { apiKey: env.OPENCODE_API_KEY }
  if (env.OPENCODE_GO_API_KEY) config.opencodeGo = { apiKey: env.OPENCODE_GO_API_KEY }
  if (env.ZAI_CODING_CN_API_KEY) config.zaiCodingCn = { apiKey: env.ZAI_CODING_CN_API_KEY }
  if (env.COPILOT_GITHUB_TOKEN) config.githubCopilot = { apiKey: env.COPILOT_GITHUB_TOKEN }
  if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_ACCOUNT_ID) {
    config.cloudflareWorkersAi = {
      apiKey: env.CLOUDFLARE_API_KEY,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
    }
    if (env.CLOUDFLARE_GATEWAY_ID) {
      config.cloudflareAiGateway = {
        apiKey: env.CLOUDFLARE_API_KEY,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        gatewayId: env.CLOUDFLARE_GATEWAY_ID,
      }
    }
  }
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
        apiKey: c.google?.apiKey,
        baseUrl: c.google?.baseURL,
      }),
    hint: 'GEMINI_API_KEY',
  },
  'google-vertex': {
    configured: (c) => !!c.googleVertex,
    build: (c) => piProvider({ providerName: 'google-vertex', env: c.env }),
    hint: 'GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION + ADC (gcloud auth)',
  },
  'azure-openai': {
    configured: (c) => !!c.azureOpenai,
    build: (c) =>
      piProvider({
        providerName: 'azure-openai',
        apiKey: c.azureOpenai?.apiKey,
        baseUrl: c.azureOpenai?.baseURL,
      }),
    hint: 'AZURE_OPENAI_API_KEY',
  },
  bedrock: {
    configured: (c) => !!c.bedrock,
    build: (c) =>
      piProvider({
        providerName: 'bedrock',
        env: c.env,
      }),
    hint: 'AWS_PROFILE or AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY',
  },
  mistral: {
    configured: (c) => !!c.mistral,
    build: (c) =>
      piProvider({
        providerName: 'mistral',
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
        apiKey: c.vercelAiGateway?.apiKey,
        baseUrl: c.vercelAiGateway?.baseURL,
      }),
    hint: 'AI_GATEWAY_API_KEY',
  },
  deepseek: {
    configured: (c) => !!c.deepseek,
    build: (c) =>
      piProvider({
        providerName: 'deepseek',
        apiKey: c.deepseek?.apiKey,
        baseUrl: c.deepseek?.baseURL,
      }),
    hint: 'DEEPSEEK_API_KEY',
  },
  fireworks: {
    configured: (c) => !!c.fireworks,
    build: (c) =>
      piProvider({
        providerName: 'fireworks',
        apiKey: c.fireworks?.apiKey,
        baseUrl: c.fireworks?.baseURL,
      }),
    hint: 'FIREWORKS_API_KEY',
  },
  together: {
    configured: (c) => !!c.together,
    build: (c) =>
      piProvider({
        providerName: 'together',
        apiKey: c.together?.apiKey,
        baseUrl: c.together?.baseURL,
      }),
    hint: 'TOGETHER_API_KEY',
  },
  moonshotai: {
    configured: (c) => !!c.moonshotai,
    build: (c) =>
      piProvider({
        providerName: 'moonshotai',
        apiKey: c.moonshotai?.apiKey,
        baseUrl: c.moonshotai?.baseURL,
      }),
    hint: 'MOONSHOT_API_KEY',
  },
  'moonshotai-cn': {
    configured: (c) => !!c.moonshotaiCn,
    build: (c) =>
      piProvider({
        providerName: 'moonshotai-cn',
        apiKey: c.moonshotaiCn?.apiKey,
        baseUrl: c.moonshotaiCn?.baseURL,
      }),
    hint: 'MOONSHOT_CN_API_KEY',
  },
  'kimi-coding': {
    configured: (c) => !!c.kimiCoding,
    build: (c) =>
      piProvider({
        providerName: 'kimi-coding',
        apiKey: c.kimiCoding?.apiKey,
        baseUrl: c.kimiCoding?.baseURL,
      }),
    hint: 'KIMI_API_KEY',
  },
  minimax: {
    configured: (c) => !!c.minimax,
    build: (c) =>
      piProvider({
        providerName: 'minimax',
        apiKey: c.minimax?.apiKey,
        baseUrl: c.minimax?.baseURL,
      }),
    hint: 'MINIMAX_API_KEY',
  },
  'minimax-cn': {
    configured: (c) => !!c.minimaxCn,
    build: (c) =>
      piProvider({
        providerName: 'minimax-cn',
        apiKey: c.minimaxCn?.apiKey,
        baseUrl: c.minimaxCn?.baseURL,
      }),
    hint: 'MINIMAX_CN_API_KEY',
  },
  'qwen-token-plan': {
    configured: (c) => !!c.qwenTokenPlan,
    build: (c) =>
      piProvider({
        providerName: 'qwen-token-plan',
        apiKey: c.qwenTokenPlan?.apiKey,
        baseUrl: c.qwenTokenPlan?.baseURL,
      }),
    hint: 'QWEN_TOKEN_PLAN_API_KEY',
  },
  'qwen-token-plan-cn': {
    configured: (c) => !!c.qwenTokenPlanCn,
    build: (c) =>
      piProvider({
        providerName: 'qwen-token-plan-cn',
        apiKey: c.qwenTokenPlanCn?.apiKey,
        baseUrl: c.qwenTokenPlanCn?.baseURL,
      }),
    hint: 'QWEN_TOKEN_PLAN_CN_API_KEY',
  },
  xiaomi: {
    configured: (c) => !!c.xiaomi,
    build: (c) =>
      piProvider({
        providerName: 'xiaomi',
        apiKey: c.xiaomi?.apiKey,
        baseUrl: c.xiaomi?.baseURL,
      }),
    hint: 'XIAOMI_API_KEY',
  },
  'xiaomi-token-plan-ams': {
    configured: (c) => !!c.xiaomiTokenPlanAms,
    build: (c) =>
      piProvider({
        providerName: 'xiaomi-token-plan-ams',
        apiKey: c.xiaomiTokenPlanAms?.apiKey,
        baseUrl: c.xiaomiTokenPlanAms?.baseURL,
      }),
    hint: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  },
  'xiaomi-token-plan-cn': {
    configured: (c) => !!c.xiaomiTokenPlanCn,
    build: (c) =>
      piProvider({
        providerName: 'xiaomi-token-plan-cn',
        apiKey: c.xiaomiTokenPlanCn?.apiKey,
        baseUrl: c.xiaomiTokenPlanCn?.baseURL,
      }),
    hint: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  },
  'xiaomi-token-plan-sgp': {
    configured: (c) => !!c.xiaomiTokenPlanSgp,
    build: (c) =>
      piProvider({
        providerName: 'xiaomi-token-plan-sgp',
        apiKey: c.xiaomiTokenPlanSgp?.apiKey,
        baseUrl: c.xiaomiTokenPlanSgp?.baseURL,
      }),
    hint: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  },
  'ant-ling': {
    configured: (c) => !!c.antLing,
    build: (c) =>
      piProvider({
        providerName: 'ant-ling',
        apiKey: c.antLing?.apiKey,
        baseUrl: c.antLing?.baseURL,
      }),
    hint: 'ANT_LING_API_KEY',
  },
  nvidia: {
    configured: (c) => !!c.nvidia,
    build: (c) =>
      piProvider({
        providerName: 'nvidia',
        apiKey: c.nvidia?.apiKey,
        baseUrl: c.nvidia?.baseURL,
      }),
    hint: 'NVIDIA_API_KEY',
  },
  opencode: {
    configured: (c) => !!c.opencode,
    build: (c) =>
      piProvider({
        providerName: 'opencode',
        apiKey: c.opencode?.apiKey,
        baseUrl: c.opencode?.baseURL,
      }),
    hint: 'OPENCODE_API_KEY',
  },
  'opencode-go': {
    configured: (c) => !!c.opencodeGo,
    build: (c) =>
      piProvider({
        providerName: 'opencode-go',
        apiKey: c.opencodeGo?.apiKey,
        baseUrl: c.opencodeGo?.baseURL,
      }),
    hint: 'OPENCODE_GO_API_KEY',
  },
  'zai-coding-cn': {
    configured: (c) => !!c.zaiCodingCn,
    build: (c) =>
      piProvider({
        providerName: 'zai-coding-cn',
        apiKey: c.zaiCodingCn?.apiKey,
        baseUrl: c.zaiCodingCn?.baseURL,
      }),
    hint: 'ZAI_CODING_CN_API_KEY',
  },
  'github-copilot': {
    configured: (c) => !!c.githubCopilot,
    build: (c) =>
      piProvider({
        providerName: 'github-copilot',
        apiKey: c.githubCopilot?.apiKey,
      }),
    hint: 'COPILOT_GITHUB_TOKEN (generic GH_TOKEN/GITHUB_TOKEN are ignored)',
  },
  'cloudflare-ai-gateway': {
    configured: (c) => !!c.cloudflareAiGateway,
    build: (c) =>
      piProvider({
        providerName: 'cloudflare-ai-gateway',
        env: c.env,
        apiKey: c.cloudflareAiGateway?.apiKey,
      }),
    hint: 'CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_GATEWAY_ID',
  },
  'cloudflare-workers-ai': {
    configured: (c) => !!c.cloudflareWorkersAi,
    build: (c) =>
      piProvider({
        providerName: 'cloudflare-workers-ai',
        env: c.env,
        apiKey: c.cloudflareWorkersAi?.apiKey,
      }),
    hint: 'CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID',
  },
  lmstudio: {
    configured: () => true,
    build: (c) =>
      piProvider({
        providerName: 'lmstudio',
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
        apiKey: c.ollama?.apiKey ?? 'ollama',
        baseUrl: c.ollama?.baseURL ?? 'http://127.0.0.1:11434/v1',
      }),
    hint: 'OLLAMA_URL (default http://127.0.0.1:11434/v1)',
  },
  llamacpp: {
    // Like lmstudio/ollama, always considered "configured" — the daemon
    // can't tell if llama-server is actually running until a request hits
    // it. Falls back to the documented default port + a placeholder
    // apiKey (llama-server ignores it unless --api-key was passed).
    configured: () => true,
    build: (c) =>
      piProvider({
        providerName: 'llamacpp',
        apiKey: c.llamacpp?.apiKey ?? 'no-key',
        baseUrl: c.llamacpp?.baseURL ?? 'http://127.0.0.1:8080/v1',
      }),
    hint: 'LLAMACPP_URL (default http://127.0.0.1:8080/v1)',
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
