// Every fact Bazilion keeps about an LLM provider, in one table. Setup lists each entry under
// "Add a provider" (`fields` are its inputs, stored like any other service field), and the runtime
// reads credentials, endpoints and Pi's provider id from the same entry. Pi's own catalog supplies
// the models; adding a provider Pi knows means adding one entry here.

import type { ServiceField } from './services.ts'

type Env = Readonly<Record<string, string | undefined>>

export interface ProviderDef {
  /** Bazilion's id: the `provider` half of an Agent's `provider:model`. */
  id: string
  displayName: string
  hint?: string
  fields: ServiceField[]
  /** Pi's id for this provider, when it differs. */
  piName?: string
  /** Variables holding the API key; the first one set wins. */
  keyEnv?: readonly string[]
  /** Further credential variables Pi reads for this provider (cloud SDK auth). */
  credentialEnv?: readonly string[]
  /** Whether credentials are present; by default, whether an API key is set. */
  configured?: (env: Env) => boolean
  /**
   * `env` names the variable an operator sets to send every request to their own endpoint;
   * `fallback` is where a model id missing from Pi's catalog goes (OpenAI-compatible).
   */
  endpoint?: { env?: string; fallback?: string }
  /**
   * A server on the operator's machine: always available, models come only from it. `window`
   * says where it reports the context window a model was loaded with.
   */
  local?: { key: string; authHeader: boolean; window: LocalWindowSource }
  /**
   * Paid by a subscription, not per use: Usage counts its tokens apart and no cost for them, even
   * where Pi's catalog prices the model.
   */
  plan?: boolean
  /** When this variable is set, the provider is used through a subscription (a Claude token). */
  planEnv?: string
  /** OpenAI-compatible `GET /models` listing, used to offer the provider's own model ids. */
  modelsUrl?: string
  /** Listed first under "Add a provider" and on the first-run screen. */
  popular?: boolean
  /**
   * An account for media only (speech, music, sound, transcription): it has no chat models, so
   * connecting it saves its key and Chat never lists it.
   */
  media?: boolean
  /**
   * The models the connect form ticks to begin with, the capable one first: it becomes the
   * Default template's model on a first run. Kept by hand; a test fails when Pi's catalog drops one.
   */
  suggested?: readonly string[]
}

function apiKey(
  id: string,
  displayName: string,
  envVar: string,
  options: {
    hint?: string
    placeholder?: string
    label?: string
    modelsUrl?: string
    plan?: boolean
  } = {},
): ProviderDef {
  return {
    id,
    displayName,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.plan ? { plan: true } : {}),
    keyEnv: [envVar],
    ...(options.modelsUrl ? { modelsUrl: options.modelsUrl } : {}),
    fields: [
      {
        envVar,
        kind: 'secret',
        label: options.label ?? 'API key',
        ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      },
    ],
  }
}

/**
 * Where a local server says a loaded model's context window: llama.cpp in its OpenAI model listing
 * (`meta.n_ctx`), LM Studio in its own `GET /api/v1/models` (`loaded_instances[].config.
 * context_length`), Ollama in `GET /api/ps` (`context_length` of a running model).
 */
export type LocalWindowSource = 'llamacpp' | 'lmstudio' | 'ollama'

function localServer(
  provider: Pick<ProviderDef, 'id' | 'displayName' | 'hint'> & {
    urlEnv: string
    url: string
    keyEnv: string
    local: { key: string; authHeader: boolean; window: LocalWindowSource }
    keyField: Omit<ServiceField, 'envVar' | 'kind'>
  },
): ProviderDef {
  return {
    id: provider.id,
    displayName: provider.displayName,
    hint: provider.hint,
    keyEnv: [provider.keyEnv],
    endpoint: { env: provider.urlEnv, fallback: provider.url },
    local: provider.local,
    fields: [
      { envVar: provider.urlEnv, kind: 'config', label: 'Address', placeholder: provider.url },
      { envVar: provider.keyEnv, kind: 'secret', advanced: true, ...provider.keyField },
    ],
  }
}

/** The order providers are listed in: ChatGPT, OpenAI, Anthropic, then rough popularity; local last. */
export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: 'openai-codex',
    displayName: 'ChatGPT',
    hint: 'Use your ChatGPT Plus, Pro or Team plan. No API key.',
    // Credentials come from the OAuth flow (/api/auth/openai), not from fields.
    fields: [],
    plan: true,
    popular: true,
    suggested: ['gpt-6.2-sol', 'gpt-6-luna'],
  },
  {
    ...apiKey('openai', 'OpenAI', 'OPENAI_API_KEY', {
      hint: 'GPT models · platform.openai.com',
      placeholder: 'sk-...',
    }),
    popular: true,
    suggested: ['gpt-6.2-sol', 'gpt-6-luna'],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    hint: 'Claude models · console.anthropic.com',
    keyEnv: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    planEnv: 'ANTHROPIC_OAUTH_TOKEN',
    fields: [
      { envVar: 'ANTHROPIC_API_KEY', kind: 'secret', label: 'API key', placeholder: 'sk-ant-...' },
      {
        envVar: 'ANTHROPIC_OAUTH_TOKEN',
        kind: 'secret',
        label: 'OAuth token (alternative to API key)',
        description: 'Takes precedence over ANTHROPIC_API_KEY when set',
        advanced: true,
      },
    ],
    popular: true,
    suggested: ['claude-fable-5-2', 'claude-haiku-5-5'],
  },
  {
    ...apiKey('google', 'Google Gemini', 'GEMINI_API_KEY', {
      hint: 'Gemini models · ai.google.dev (free tier available)',
      placeholder: 'AIza...',
    }),
    popular: true,
    suggested: ['gemini-4-argon', 'gemini-3.8-flash'],
  },
  {
    id: 'google-vertex',
    displayName: 'Google Vertex AI',
    hint: 'Authenticates via `gcloud auth application-default login`',
    credentialEnv: [
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ],
    configured: (env) => Boolean(env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_LOCATION),
    fields: [
      {
        envVar: 'GOOGLE_CLOUD_PROJECT',
        kind: 'config',
        label: 'GCP project ID',
        placeholder: 'my-project-123456',
      },
      {
        envVar: 'GOOGLE_CLOUD_LOCATION',
        kind: 'config',
        label: 'GCP region',
        placeholder: 'us-central1',
      },
    ],
  },
  { ...apiKey('azure-openai', 'Azure OpenAI', 'AZURE_OPENAI_API_KEY'), piName: 'azure' },
  {
    id: 'bedrock',
    displayName: 'Amazon Bedrock',
    hint: 'Authenticates via AWS SDK env (AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET)',
    piName: 'amazon-bedrock',
    credentialEnv: [
      'AWS_PROFILE',
      'AWS_BEARER_TOKEN_BEDROCK',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_REGION',
      'AWS_DEFAULT_REGION',
    ],
    configured: (env) =>
      Boolean(
        env.AWS_PROFILE ||
          env.AWS_BEARER_TOKEN_BEDROCK ||
          (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
      ),
    fields: [],
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    hint: 'Use a GitHub Copilot subscription to call Claude/GPT/Gemini via Copilot',
    keyEnv: ['COPILOT_GITHUB_TOKEN'],
    plan: true,
    fields: [
      {
        envVar: 'COPILOT_GITHUB_TOKEN',
        kind: 'secret',
        label: 'GitHub token',
        description: 'Generic GH_TOKEN/GITHUB_TOKEN are ignored — set this scoped variable.',
      },
    ],
  },
  apiKey('deepseek', 'DeepSeek', 'DEEPSEEK_API_KEY', {
    hint: 'DeepSeek V4 Flash / Pro · platform.deepseek.com',
  }),
  apiKey('mistral', 'Mistral', 'MISTRAL_API_KEY', {
    hint: 'mistral.ai',
    modelsUrl: 'https://api.mistral.ai/v1',
  }),
  apiKey('xai', 'xAI', 'XAI_API_KEY', { hint: 'Grok · x.ai', modelsUrl: 'https://api.x.ai/v1' }),
  apiKey('groq', 'Groq', 'GROQ_API_KEY', {
    hint: 'Fast inference · groq.com',
    modelsUrl: 'https://api.groq.com/openai/v1',
  }),
  apiKey('cerebras', 'Cerebras', 'CEREBRAS_API_KEY', { modelsUrl: 'https://api.cerebras.ai/v1' }),
  {
    ...apiKey('fireworks', 'Fireworks AI', 'FIREWORKS_API_KEY', {
      hint: 'DeepSeek/GLM/Kimi via fireworks.ai',
    }),
    // Fireworks serves every model it hosts from one endpoint, so models newer than Pi's
    // catalog stay usable.
    endpoint: { fallback: 'https://api.fireworks.ai/inference/v1' },
  },
  apiKey('together', 'Together AI', 'TOGETHER_API_KEY', {
    hint: 'Open-weight models · together.ai',
  }),
  apiKey('baseten', 'Baseten', 'BASETEN_API_KEY', {
    hint: 'Hosted open-weight models · baseten.co',
  }),
  apiKey('moonshotai', 'Moonshot AI', 'MOONSHOT_API_KEY', {
    hint: 'Kimi K2 and K3 models · platform.moonshot.ai',
  }),
  apiKey('moonshotai-cn', 'Moonshot AI (CN)', 'MOONSHOT_CN_API_KEY', {
    hint: 'Kimi models via the China endpoint · platform.moonshot.cn',
    modelsUrl: 'https://api.moonshot.cn/v1',
  }),
  apiKey('kimi-coding', 'Kimi Coding', 'KIMI_API_KEY', {
    hint: 'Coding-tuned Kimi endpoint · platform.moonshot.cn',
  }),
  apiKey('minimax', 'MiniMax', 'MINIMAX_API_KEY', {
    hint: 'MiniMax M2/M3 family · platform.minimaxi.com',
  }),
  apiKey('minimax-cn', 'MiniMax (CN)', 'MINIMAX_CN_API_KEY', {
    hint: 'MiniMax M2/M3 family via the China endpoint',
  }),
  // Each plan has its own key; Pi also reads the older shared QWEN_TOKEN_PLAN_API_KEY.
  apiKey('qwen-token-plan', 'Qwen Token Plan Team', 'QWEN_TOKEN_PLAN_TEAM_API_KEY', {
    hint: 'Team coding-model subscription · international endpoint',
    plan: true,
  }),
  apiKey('qwen-token-plan-cn', 'Qwen Token Plan Team (CN)', 'QWEN_TOKEN_PLAN_TEAM_CN_API_KEY', {
    hint: 'Team coding-model subscription · China endpoint',
    plan: true,
  }),
  apiKey(
    'qwen-token-plan-individual',
    'Qwen Token Plan Individual',
    'QWEN_TOKEN_PLAN_INDIVIDUAL_API_KEY',
    { hint: 'Individual subscription · international endpoint', plan: true },
  ),
  apiKey(
    'qwen-token-plan-individual-cn',
    'Qwen Token Plan Individual (CN)',
    'QWEN_TOKEN_PLAN_INDIVIDUAL_CN_API_KEY',
    { hint: 'Individual subscription · China endpoint', plan: true },
  ),
  apiKey('xiaomi', 'Xiaomi MiMo', 'XIAOMI_API_KEY', {
    hint: 'API billing endpoint · platform.xiaomimimo.com',
  }),
  apiKey('xiaomi-token-plan-ams', 'Xiaomi MiMo Token Plan (AMS)', 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', {
    hint: 'MiMo token-plan endpoint in Amsterdam',
    plan: true,
    modelsUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
  }),
  apiKey('xiaomi-token-plan-cn', 'Xiaomi MiMo Token Plan (CN)', 'XIAOMI_TOKEN_PLAN_CN_API_KEY', {
    hint: 'MiMo token-plan endpoint in China',
    plan: true,
    modelsUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
  }),
  apiKey('xiaomi-token-plan-sgp', 'Xiaomi MiMo Token Plan (SGP)', 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', {
    hint: 'MiMo token-plan endpoint in Singapore',
    plan: true,
    modelsUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
  }),
  apiKey('ant-ling', 'Ant Ling', 'ANT_LING_API_KEY', {
    hint: 'Ling/Ring models · api.ant-ling.com',
    modelsUrl: 'https://api.ant-ling.com/v1',
  }),
  apiKey('nvidia', 'NVIDIA NIM', 'NVIDIA_API_KEY', {
    hint: 'NVIDIA hosted models · build.nvidia.com',
    modelsUrl: 'https://integrate.api.nvidia.com/v1',
  }),
  apiKey('zai', 'zAI', 'ZAI_API_KEY'),
  apiKey('zai-coding-cn', 'zAI Coding (CN)', 'ZAI_CODING_CN_API_KEY', {
    hint: 'GLM coding endpoint · open.bigmodel.cn',
    modelsUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  }),
  apiKey('meta', 'Meta', 'META_API_KEY', { hint: 'Meta model API · api.meta.ai' }),
  apiKey('radius', 'Radius', 'RADIUS_API_KEY', { hint: 'Radius gateway · radius.pi.dev' }),
  apiKey('huggingface', 'Hugging Face', 'HF_TOKEN', {
    hint: 'Inference endpoints · huggingface.co',
    label: 'Access token',
    placeholder: 'hf_...',
  }),
  {
    ...apiKey('elevenlabs', 'ElevenLabs', 'ELEVENLABS_API_KEY', {
      hint: 'Voices, music, sound effects and transcription · elevenlabs.io',
    }),
    media: true,
  },
  {
    id: 'cloudflare-ai-gateway',
    displayName: 'Cloudflare AI Gateway',
    hint: 'Per-gateway routing to OpenAI/Anthropic/Workers AI',
    keyEnv: ['CLOUDFLARE_API_KEY'],
    credentialEnv: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_GATEWAY_ID'],
    configured: (env) =>
      Boolean(env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_GATEWAY_ID),
    fields: [
      { envVar: 'CLOUDFLARE_API_KEY', kind: 'secret', label: 'API key' },
      { envVar: 'CLOUDFLARE_ACCOUNT_ID', kind: 'config', label: 'Account ID' },
      { envVar: 'CLOUDFLARE_GATEWAY_ID', kind: 'config', label: 'Gateway ID' },
    ],
  },
  {
    id: 'cloudflare-workers-ai',
    displayName: 'Cloudflare Workers AI',
    hint: 'Inference on Cloudflare Workers · ai.cloudflare.com',
    keyEnv: ['CLOUDFLARE_API_KEY'],
    credentialEnv: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
    configured: (env) => Boolean(env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_ACCOUNT_ID),
    fields: [
      { envVar: 'CLOUDFLARE_API_KEY', kind: 'secret', label: 'API key' },
      { envVar: 'CLOUDFLARE_ACCOUNT_ID', kind: 'config', label: 'Account ID' },
    ],
  },
  {
    ...apiKey('openrouter', 'OpenRouter', 'OPENROUTER_API_KEY', {
      hint: 'Many providers through one key · openrouter.ai',
      placeholder: 'sk-or-...',
      modelsUrl: 'https://openrouter.ai/api/v1',
    }),
    popular: true,
    suggested: ['~anthropic/claude-sonnet-latest', '~anthropic/claude-haiku-latest'],
  },
  {
    id: 'vercel-ai-gateway',
    displayName: 'Vercel AI Gateway',
    keyEnv: ['AI_GATEWAY_API_KEY'],
    endpoint: { env: 'AI_GATEWAY_BASE_URL' },
    modelsUrl: 'https://ai-gateway.vercel.sh/v1',
    fields: [
      { envVar: 'AI_GATEWAY_API_KEY', kind: 'secret', label: 'API key' },
      {
        envVar: 'AI_GATEWAY_BASE_URL',
        kind: 'config',
        label: 'Base URL (optional)',
        placeholder: 'https://ai-gateway.vercel.sh/v1',
        advanced: true,
      },
    ],
  },
  apiKey('opencode', 'OpenCode', 'OPENCODE_API_KEY', {
    hint: 'OpenAI-compatible proxy from the OpenCode CLI',
  }),
  apiKey('opencode-go', 'OpenCode Go', 'OPENCODE_GO_API_KEY', {
    hint: 'OpenCode hosted Go endpoint',
    modelsUrl: 'https://opencode.ai/inference/go/v1',
  }),
  localServer({
    id: 'lmstudio',
    displayName: 'LM Studio',
    hint: 'Local inference · lmstudio.ai',
    urlEnv: 'LMSTUDIO_URL',
    url: 'http://127.0.0.1:1234/v1',
    keyEnv: 'LMSTUDIO_API_KEY',
    local: { key: 'lm-studio', authHeader: false, window: 'lmstudio' },
    keyField: { label: 'API key (rarely needed)' },
  }),
  localServer({
    id: 'ollama',
    displayName: 'Ollama',
    hint: 'Local inference · ollama.com',
    urlEnv: 'OLLAMA_URL',
    url: 'http://127.0.0.1:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    local: { key: 'ollama', authHeader: false, window: 'ollama' },
    keyField: { label: 'API key (rarely needed)' },
  }),
  localServer({
    id: 'llamacpp',
    displayName: 'llama.cpp',
    hint: 'Local inference · llama.cpp llama-server (OpenAI-compat /v1 endpoint)',
    urlEnv: 'LLAMACPP_URL',
    url: 'http://127.0.0.1:9931/v1',
    keyEnv: 'LLAMACPP_API_KEY',
    local: { key: 'no-key', authHeader: true, window: 'llamacpp' },
    keyField: {
      label: 'API key (only if started with --api-key)',
      description:
        'llama-server runs without auth by default. Set this only if you launched the server with the `--api-key KEY` flag.',
    },
  }),
]

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]))

export function findProvider(id: string): ProviderDef | undefined {
  return BY_ID.get(id)
}

/** Split a `provider:model` string; the model id may itself contain colons. */
export function parseModelString(model: string): { providerName: string; modelId: string } {
  const at = model.indexOf(':')
  if (at <= 0 || at === model.length - 1) {
    throw new Error(`invalid model string "${model}": expected "provider:model"`)
  }
  return { providerName: model.slice(0, at), modelId: model.slice(at + 1) }
}

export function piProviderName(id: string): string {
  return findProvider(id)?.piName ?? id
}

/** The provider's API key from `env`, or a local server's placeholder key. */
export function providerApiKey(id: string, env: Env): string | undefined {
  const provider = findProvider(id)
  for (const name of provider?.keyEnv ?? []) {
    const value = env[name]
    if (value) return value
  }
  return provider?.local?.key
}

/** The provider-specific credential variables present in `env` (Bedrock, Vertex, Cloudflare). */
export function providerCredentialEnv(id: string, env: Env): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const name of findProvider(id)?.credentialEnv ?? []) {
    const value = env[name]
    if (value) values[name] = value
  }
  return Object.keys(values).length > 0 ? values : undefined
}

/** The endpoint the operator configured for this provider, if any. */
export function providerEndpoint(id: string, env: Env): string | undefined {
  const name = findProvider(id)?.endpoint?.env
  return (name && env[name]) || undefined
}

/** Whether the provider's credentials are present. Local servers need none. */
export function isProviderConfigured(id: string, env: Env): boolean {
  const provider = findProvider(id)
  if (!provider) return false
  if (provider.local) return true
  if (provider.configured) return provider.configured(env)
  return (provider.keyEnv ?? []).some((name) => Boolean(env[name]))
}

/** The providers that read `envVar` as one of their fields (a few keys are shared). */
export function providersUsingField(envVar: string): string[] {
  return PROVIDERS.filter((provider) =>
    provider.fields.some((field) => field.envVar === envVar),
  ).map((provider) => provider.id)
}

/** Where to list the provider's live models (`GET <url>/models`), when it offers that. */
export function providerModelsUrl(id: string, env: Env): string | undefined {
  const provider = findProvider(id)
  if (!provider?.local && !provider?.modelsUrl) return undefined
  return providerEndpoint(id, env) ?? provider.modelsUrl ?? provider.endpoint?.fallback
}
