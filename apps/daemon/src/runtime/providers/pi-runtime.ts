import type { Api, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

const PROVIDER_ALIASES: Record<string, string> = {
  bedrock: 'amazon-bedrock',
  'azure-openai': 'azure-openai-responses',
}

const LOCAL_PROVIDERS: Record<string, { baseUrl: string; apiKey: string; authHeader: boolean }> = {
  lmstudio: {
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: 'lm-studio',
    authHeader: false,
  },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', authHeader: false },
  llamacpp: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'no-key', authHeader: true },
}

const API_KEY_ENV: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY'],
  'azure-openai': ['AZURE_OPENAI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  xai: ['XAI_API_KEY'],
  zai: ['ZAI_API_KEY'],
  huggingface: ['HF_TOKEN'],
  openrouter: ['OPENROUTER_API_KEY'],
  'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  'moonshotai-cn': ['MOONSHOT_CN_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_CN_API_KEY'],
  'qwen-token-plan': ['QWEN_TOKEN_PLAN_API_KEY'],
  'qwen-token-plan-cn': ['QWEN_TOKEN_PLAN_CN_API_KEY'],
  xiaomi: ['XIAOMI_API_KEY'],
  'xiaomi-token-plan-ams': ['XIAOMI_TOKEN_PLAN_AMS_API_KEY'],
  'xiaomi-token-plan-cn': ['XIAOMI_TOKEN_PLAN_CN_API_KEY'],
  'xiaomi-token-plan-sgp': ['XIAOMI_TOKEN_PLAN_SGP_API_KEY'],
  'ant-ling': ['ANT_LING_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_GO_API_KEY'],
  'zai-coding-cn': ['ZAI_CODING_CN_API_KEY'],
  'github-copilot': ['COPILOT_GITHUB_TOKEN'],
  'cloudflare-ai-gateway': ['CLOUDFLARE_API_KEY'],
  'cloudflare-workers-ai': ['CLOUDFLARE_API_KEY'],
  lmstudio: ['LMSTUDIO_API_KEY'],
  ollama: ['OLLAMA_API_KEY'],
  llamacpp: ['LLAMACPP_API_KEY'],
}

const PROVIDER_ENV: Record<string, readonly string[]> = {
  bedrock: [
    'AWS_PROFILE',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
  ],
  'google-vertex': [
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ],
  'cloudflare-ai-gateway': ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'],
  'cloudflare-workers-ai': ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
}

export interface BazilionPiRuntimeOptions {
  providerName: string
  env: NodeJS.ProcessEnv
  apiKey?: string
  baseUrl?: string
  modelId?: string
}

export function piProviderName(providerName: string): string {
  return PROVIDER_ALIASES[providerName] ?? providerName
}

export function providerApiKey(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const name of API_KEY_ENV[providerName] ?? []) {
    const value = env[name]
    if (value) return value
  }
  return LOCAL_PROVIDERS[providerName]?.apiKey
}

export function providerBaseUrl(providerName: string, env: NodeJS.ProcessEnv): string | undefined {
  switch (providerName) {
    case 'lmstudio':
      return env.LMSTUDIO_URL ?? LOCAL_PROVIDERS.lmstudio?.baseUrl
    case 'ollama':
      return env.OLLAMA_URL ?? LOCAL_PROVIDERS.ollama?.baseUrl
    case 'llamacpp':
      return env.LLAMACPP_URL ?? LOCAL_PROVIDERS.llamacpp?.baseUrl
    case 'vercel-ai-gateway':
      return env.AI_GATEWAY_BASE_URL
    default:
      return undefined
  }
}

function providerCredentialEnv(
  providerName: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const name of PROVIDER_ENV[providerName] ?? []) {
    const value = env[name]
    if (value !== undefined) result[name] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function fallbackApi(providerName: string): Api {
  switch (providerName) {
    case 'anthropic':
      return 'anthropic-messages'
    case 'google':
      return 'google-generative-ai'
    case 'google-vertex':
      return 'google-vertex'
    case 'azure-openai':
      return 'azure-openai-responses'
    case 'bedrock':
      return 'bedrock-converse-stream'
    case 'openai-codex':
      return 'openai-codex-responses'
    default:
      return 'openai-completions'
  }
}

export function fallbackPiModel(
  providerName: string,
  modelId: string,
  baseUrl?: string,
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: fallbackApi(providerName),
    provider: piProviderName(providerName),
    baseUrl: baseUrl ?? '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 4_096,
  }
}

export async function createBazilionPiRuntime(
  options: BazilionPiRuntimeOptions,
): Promise<ModelRuntime> {
  const providerName = options.providerName
  const canonicalName = piProviderName(providerName)
  const credentials = new InMemoryCredentialStore()
  const apiKey = options.apiKey ?? providerApiKey(providerName, options.env)
  const credentialEnv = providerCredentialEnv(providerName, options.env)

  if (apiKey || credentialEnv) {
    await credentials.modify(canonicalName, async () => ({
      type: 'api_key',
      ...(apiKey ? { key: apiKey } : {}),
      ...(credentialEnv ? { env: credentialEnv } : {}),
    }))
  }

  const runtime = await ModelRuntime.create({ credentials, modelsPath: null })
  const local = LOCAL_PROVIDERS[providerName]
  const baseUrl = options.baseUrl ?? providerBaseUrl(providerName, options.env)

  if (local) {
    const modelId = options.modelId ?? 'model-name'
    const model = fallbackPiModel(providerName, modelId, baseUrl ?? local.baseUrl)
    runtime.registerProvider(canonicalName, {
      baseUrl: baseUrl ?? local.baseUrl,
      api: 'openai-completions',
      authHeader: local.authHeader,
      apiKey: apiKey ?? local.apiKey,
      models: [model],
    })
  } else if (baseUrl) {
    runtime.registerProvider(canonicalName, { baseUrl })
  }

  return runtime
}

export function resolvePiModel(
  runtime: ModelRuntime,
  providerName: string,
  modelId: string,
  baseUrl?: string,
): Model<Api> {
  const known = runtime.getModel(piProviderName(providerName), modelId)
  if (known) return baseUrl ? { ...known, baseUrl } : known
  return fallbackPiModel(providerName, modelId, baseUrl)
}
