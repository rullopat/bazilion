// Per-service field registry — the shape of the /config page.
//
// Each entry describes one "thing" the user might configure: an LLM provider
// (Anthropic, LM Studio, …) or an ancillary service (Brave Search, SearXNG).
// Fields know which storage backend they live in: `secret` → the encrypted
// `secrets` table, `config` → the plaintext `config` table. The registry is
// the single source of truth for the UI layout and for the generic
// field-write endpoint's dispatch.
//
// When adding a new provider or service, append an entry here and the
// config page + CLI pick it up automatically.

export type FieldKind = 'secret' | 'config'

export interface ServiceField {
  /** Env var name — canonical key in both stores. */
  envVar: string
  kind: FieldKind
  label: string
  placeholder?: string
  description?: string
}

export type ServiceCategory = 'provider' | 'service' | 'integration'

export interface ServiceDef {
  /** Matches the provider-registry key for providers (e.g. 'anthropic'). */
  id: string
  displayName: string
  category: ServiceCategory
  /** Display grouping label shown above the card on the /config tabs. */
  team?: string
  /** Sign-up link, docs, or 1-line description shown on the card. */
  hint?: string
  fields: ServiceField[]
}

/**
 * One-liner: what's shown on each service card.
 * Order here is the display order on the config page.
 */
export const SERVICES: ServiceDef[] = [
  // --- LLM providers (configured via API keys / URLs) ---
  // Top 3: openai-codex (ChatGPT OAuth), openai (API key), anthropic.
  // Everything else in rough popularity order; locals last.
  {
    id: 'openai-codex',
    displayName: 'OpenAI ChatGPT (OAuth)',
    category: 'provider',
    hint: 'Use your ChatGPT Plus/Pro/Team account (same login as Codex CLI)',
    // No form fields — credentials come from an OAuth flow. The /config page
    // renders a Connect/Disconnect card using /api/auth/openai instead of the
    // standard field inputs.
    fields: [],
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    category: 'provider',
    hint: 'GPT models · platform.openai.com',
    fields: [{ envVar: 'OPENAI_API_KEY', kind: 'secret', label: 'API key', placeholder: 'sk-...' }],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    category: 'provider',
    hint: 'Claude models · console.anthropic.com',
    fields: [
      { envVar: 'ANTHROPIC_API_KEY', kind: 'secret', label: 'API key', placeholder: 'sk-ant-...' },
      {
        envVar: 'ANTHROPIC_OAUTH_TOKEN',
        kind: 'secret',
        label: 'OAuth token (alternative to API key)',
        description: 'Takes precedence over ANTHROPIC_API_KEY when set',
      },
    ],
  },
  {
    id: 'google',
    displayName: 'Google (Gemini)',
    category: 'provider',
    hint: 'Gemini models · ai.google.dev (free tier available)',
    fields: [
      { envVar: 'GEMINI_API_KEY', kind: 'secret', label: 'API key', placeholder: 'AIza...' },
    ],
  },
  {
    id: 'google-vertex',
    displayName: 'Google Vertex AI',
    category: 'provider',
    hint: 'Authenticates via `gcloud auth application-default login`',
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
  {
    id: 'azure-openai',
    displayName: 'Azure OpenAI',
    category: 'provider',
    fields: [{ envVar: 'AZURE_OPENAI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'bedrock',
    displayName: 'Amazon Bedrock',
    category: 'provider',
    hint: 'Authenticates via AWS SDK env (AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET)',
    fields: [],
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    category: 'provider',
    hint: 'Use a GitHub Copilot subscription to call Claude/GPT/Gemini via Copilot',
    fields: [
      {
        envVar: 'COPILOT_GITHUB_TOKEN',
        kind: 'secret',
        label: 'GitHub token',
        description:
          'Generic GH_TOKEN/GITHUB_TOKEN are ignored — set this scoped variable explicitly (or run `bazilion auth copilot login` once available).',
      },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    category: 'provider',
    hint: 'DeepSeek V4 Flash / Pro · platform.deepseek.com',
    fields: [{ envVar: 'DEEPSEEK_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    category: 'provider',
    hint: 'mistral.ai',
    fields: [{ envVar: 'MISTRAL_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    category: 'provider',
    hint: 'Grok · x.ai',
    fields: [{ envVar: 'XAI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'groq',
    displayName: 'Groq',
    category: 'provider',
    hint: 'Fast inference · groq.com',
    fields: [{ envVar: 'GROQ_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    category: 'provider',
    fields: [{ envVar: 'CEREBRAS_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    category: 'provider',
    hint: 'DeepSeek/GLM/Kimi via fireworks.ai',
    fields: [{ envVar: 'FIREWORKS_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'together',
    displayName: 'Together AI',
    category: 'provider',
    hint: 'Open-weight models · together.ai',
    fields: [{ envVar: 'TOGETHER_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'moonshotai',
    displayName: 'Moonshot AI',
    category: 'provider',
    hint: 'Kimi K2/K2.5/K2.6/K2.7 · platform.moonshot.ai',
    fields: [{ envVar: 'MOONSHOT_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'moonshotai-cn',
    displayName: 'Moonshot AI (CN)',
    category: 'provider',
    hint: 'Kimi models via the China endpoint · platform.moonshot.cn',
    fields: [{ envVar: 'MOONSHOT_CN_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'kimi-coding',
    displayName: 'Kimi Coding',
    category: 'provider',
    hint: 'Coding-tuned Kimi endpoint · platform.moonshot.cn',
    fields: [{ envVar: 'KIMI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    category: 'provider',
    hint: 'MiniMax M2/M3 family · platform.minimaxi.com',
    fields: [{ envVar: 'MINIMAX_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'minimax-cn',
    displayName: 'MiniMax (CN)',
    category: 'provider',
    hint: 'MiniMax M2/M3 family via the China endpoint',
    fields: [{ envVar: 'MINIMAX_CN_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    category: 'provider',
    hint: 'API billing endpoint · platform.xiaomimimo.com',
    fields: [{ envVar: 'XIAOMI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'xiaomi-token-plan-ams',
    displayName: 'Xiaomi MiMo Token Plan (AMS)',
    category: 'provider',
    hint: 'MiMo token-plan endpoint in Amsterdam',
    fields: [{ envVar: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'xiaomi-token-plan-cn',
    displayName: 'Xiaomi MiMo Token Plan (CN)',
    category: 'provider',
    hint: 'MiMo token-plan endpoint in China',
    fields: [{ envVar: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'xiaomi-token-plan-sgp',
    displayName: 'Xiaomi MiMo Token Plan (SGP)',
    category: 'provider',
    hint: 'MiMo token-plan endpoint in Singapore',
    fields: [{ envVar: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'ant-ling',
    displayName: 'Ant Ling',
    category: 'provider',
    hint: 'Ling/Ring models · api.ant-ling.com',
    fields: [{ envVar: 'ANT_LING_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    category: 'provider',
    hint: 'NVIDIA hosted models · build.nvidia.com',
    fields: [{ envVar: 'NVIDIA_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'zai',
    displayName: 'zAI',
    category: 'provider',
    fields: [{ envVar: 'ZAI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'zai-coding-cn',
    displayName: 'zAI Coding (CN)',
    category: 'provider',
    hint: 'GLM coding endpoint · open.bigmodel.cn',
    fields: [{ envVar: 'ZAI_CODING_CN_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'huggingface',
    displayName: 'Hugging Face',
    category: 'provider',
    hint: 'Inference endpoints · huggingface.co',
    fields: [{ envVar: 'HF_TOKEN', kind: 'secret', label: 'Access token', placeholder: 'hf_...' }],
  },
  {
    id: 'cloudflare-ai-gateway',
    displayName: 'Cloudflare AI Gateway',
    category: 'provider',
    hint: 'Per-gateway routing to OpenAI/Anthropic/Workers AI',
    fields: [
      { envVar: 'CLOUDFLARE_API_KEY', kind: 'secret', label: 'API key' },
      { envVar: 'CLOUDFLARE_ACCOUNT_ID', kind: 'config', label: 'Account ID' },
      { envVar: 'CLOUDFLARE_GATEWAY_ID', kind: 'config', label: 'Gateway ID' },
    ],
  },
  {
    id: 'cloudflare-workers-ai',
    displayName: 'Cloudflare Workers AI',
    category: 'provider',
    hint: 'Inference on Cloudflare Workers · ai.cloudflare.com',
    fields: [
      { envVar: 'CLOUDFLARE_API_KEY', kind: 'secret', label: 'API key' },
      { envVar: 'CLOUDFLARE_ACCOUNT_ID', kind: 'config', label: 'Account ID' },
    ],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    category: 'provider',
    hint: 'Proxy for 200+ models · openrouter.ai',
    fields: [
      { envVar: 'OPENROUTER_API_KEY', kind: 'secret', label: 'API key', placeholder: 'sk-or-...' },
    ],
  },
  {
    id: 'vercel-ai-gateway',
    displayName: 'Vercel AI Gateway',
    category: 'provider',
    fields: [
      { envVar: 'AI_GATEWAY_API_KEY', kind: 'secret', label: 'API key' },
      {
        envVar: 'AI_GATEWAY_BASE_URL',
        kind: 'config',
        label: 'Base URL (optional)',
        placeholder: 'https://ai-gateway.vercel.sh/v1',
      },
    ],
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    category: 'provider',
    hint: 'OpenAI-compatible proxy from the OpenCode CLI',
    fields: [{ envVar: 'OPENCODE_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    category: 'provider',
    hint: 'OpenCode hosted Go endpoint',
    fields: [{ envVar: 'OPENCODE_GO_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio',
    category: 'provider',
    hint: 'Local inference · lmstudio.ai',
    fields: [
      {
        envVar: 'LMSTUDIO_URL',
        kind: 'config',
        label: 'Endpoint URL',
        placeholder: 'http://127.0.0.1:1234/v1',
      },
      {
        envVar: 'LMSTUDIO_API_KEY',
        kind: 'secret',
        label: 'API key (rarely needed)',
      },
    ],
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    category: 'provider',
    hint: 'Local inference · ollama.com',
    fields: [
      {
        envVar: 'OLLAMA_URL',
        kind: 'config',
        label: 'Endpoint URL',
        placeholder: 'http://127.0.0.1:11434/v1',
      },
      {
        envVar: 'OLLAMA_API_KEY',
        kind: 'secret',
        label: 'API key (rarely needed)',
      },
    ],
  },
  {
    id: 'llamacpp',
    displayName: 'llama.cpp',
    category: 'provider',
    hint: 'Local inference · llama.cpp llama-server (OpenAI-compat /v1 endpoint)',
    fields: [
      {
        envVar: 'LLAMACPP_URL',
        kind: 'config',
        label: 'Endpoint URL',
        placeholder: 'http://127.0.0.1:8080/v1',
      },
      {
        envVar: 'LLAMACPP_API_KEY',
        kind: 'secret',
        label: 'API key (only if started with --api-key)',
        description:
          'llama-server runs without auth by default. Set this only if you launched the server with the `--api-key KEY` flag.',
      },
    ],
  },

  // --- Ancillary services (web search, etc) ---
  {
    id: 'firecrawl',
    displayName: 'Firecrawl',
    category: 'service',
    team: 'Web Search',
    hint: 'web_fetch fallback for JS-heavy/blocked pages · firecrawl.dev (free tier available)',
    fields: [
      {
        envVar: 'FIRECRAWL_API_KEY',
        kind: 'secret',
        label: 'API key',
        placeholder: 'fc-...',
        description:
          'When set, web_fetch automatically falls back to Firecrawl if the primary Readability extraction yields too little content.',
      },
      {
        envVar: 'FIRECRAWL_URL',
        kind: 'config',
        label: 'Base URL (optional, for self-hosted)',
        placeholder: 'https://api.firecrawl.dev',
      },
    ],
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    category: 'service',
    team: 'Web Search',
    hint: 'Web search tool · free tier at brave.com/search/api/',
    fields: [{ envVar: 'BRAVE_API_KEY', kind: 'secret', label: 'API key', placeholder: 'BSA...' }],
  },
  {
    id: 'searxng',
    displayName: 'SearXNG',
    category: 'service',
    team: 'Web Search',
    hint: 'Self-hosted meta-search engine · searxng.org',
    fields: [
      {
        envVar: 'SEARXNG_URL',
        kind: 'config',
        label: 'Instance URL',
        placeholder: 'https://searxng.example.com',
      },
    ],
  },
  {
    id: 'browser',
    displayName: 'Browser Automation',
    category: 'service',
    team: 'Browser',
    hint: 'Playwright-driven browser tools (navigate, snapshot, click, screenshot). Run `pnpm exec playwright install chromium` once.',
    fields: [
      {
        envVar: 'BROWSER_ENABLED',
        kind: 'config',
        label: 'Enable browser tools',
        placeholder: 'true',
        description: 'Expose the browser_* tools to agents (true/false). Default true.',
      },
      {
        envVar: 'BROWSER_HEADLESS',
        kind: 'config',
        label: 'Headless',
        placeholder: 'true',
        description: 'Run Chromium headless (true/false). Default true.',
      },
      {
        envVar: 'BROWSER_ALLOW_PRIVATE_NETWORK',
        kind: 'config',
        label: 'Allow private network',
        placeholder: 'false',
        description:
          'Permit the browser to reach loopback/private IPs (SSRF guard off). Default false — only enable for local dev.',
      },
      {
        envVar: 'BROWSER_IDLE_MS',
        kind: 'config',
        label: 'Idle timeout (ms)',
        placeholder: '900000',
        description: 'Close an idle browser session after this many ms. Default 900000 (15 min).',
      },
      {
        envVar: 'BROWSER_MAX_SESSIONS',
        kind: 'config',
        label: 'Max concurrent sessions',
        placeholder: '4',
        description: 'Cap on simultaneously-open browser sessions (LRU-evicted). Default 4.',
      },
    ],
  },

  // --- External integrations (chat bridges, etc) ---
  // Each integration has its own dedicated /config/integrations/* page with
  // workflow-specific UI (preflight health, setup wizard, …). The fields
  // here exist so the keys are allowlisted in the config/secrets stores and
  // surfaced through the generic `PUT /api/config/fields/:envVar` endpoint.
  // Daemon-managed internal state keys (watermarks, derived topic ids) live
  // in repos/config.ts:INTERNAL_CONFIG_KEYS instead, since the user never
  // edits them.
  {
    id: 'telegram',
    displayName: 'Telegram',
    category: 'integration',
    hint: 'Forum-supergroup bot for talking to your agents from a phone',
    fields: [
      {
        envVar: 'TELEGRAM_BOT_TOKEN',
        kind: 'secret',
        label: 'Bot token',
        placeholder: '1234567890:ABC...',
        description: 'Get one from @BotFather → /newbot. Disable Privacy Mode in Bot Settings.',
      },
      {
        envVar: 'TELEGRAM_CHAT_ID',
        kind: 'config',
        label: 'Supergroup chat ID',
        placeholder: '-1001234567890',
        description: 'Numeric id of the forum-enabled supergroup the bot is admin in.',
      },
    ],
  },
]

/**
 * Fast lookup: envVar → the field definition + owning service.
 * Rebuilt once at module init — the list is static.
 */
const FIELD_INDEX: Map<string, { service: ServiceDef; field: ServiceField }> = (() => {
  const m = new Map<string, { service: ServiceDef; field: ServiceField }>()
  for (const service of SERVICES) {
    for (const field of service.fields) {
      m.set(field.envVar, { service, field })
    }
  }
  return m
})()

export function findFieldByEnvVar(
  envVar: string,
): { service: ServiceDef; field: ServiceField } | undefined {
  return FIELD_INDEX.get(envVar)
}

export function servicesByCategory(category: ServiceCategory): ServiceDef[] {
  return SERVICES.filter((s) => s.category === category)
}
