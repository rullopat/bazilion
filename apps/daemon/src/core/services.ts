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

export type ServiceCategory = 'provider' | 'service'

export interface ServiceDef {
  /** Matches the provider-registry key for providers (e.g. 'anthropic'). */
  id: string
  displayName: string
  category: ServiceCategory
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
    id: 'openai',
    displayName: 'OpenAI',
    category: 'provider',
    hint: 'GPT models · platform.openai.com',
    fields: [{ envVar: 'OPENAI_API_KEY', kind: 'secret', label: 'API key', placeholder: 'sk-...' }],
  },
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
    id: 'mistral',
    displayName: 'Mistral',
    category: 'provider',
    hint: 'mistral.ai',
    fields: [{ envVar: 'MISTRAL_API_KEY', kind: 'secret', label: 'API key' }],
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
    id: 'xai',
    displayName: 'xAI',
    category: 'provider',
    hint: 'Grok · x.ai',
    fields: [{ envVar: 'XAI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'zai',
    displayName: 'zAI',
    category: 'provider',
    fields: [{ envVar: 'ZAI_API_KEY', kind: 'secret', label: 'API key' }],
  },
  {
    id: 'huggingface',
    displayName: 'Hugging Face',
    category: 'provider',
    hint: 'Inference endpoints · huggingface.co',
    fields: [{ envVar: 'HF_TOKEN', kind: 'secret', label: 'Access token', placeholder: 'hf_...' }],
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

  // --- Ancillary services (web search, etc) ---
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    category: 'service',
    hint: 'Web search tool · free tier at brave.com/search/api/',
    fields: [{ envVar: 'BRAVE_API_KEY', kind: 'secret', label: 'API key', placeholder: 'BSA...' }],
  },
  {
    id: 'searxng',
    displayName: 'SearXNG',
    category: 'service',
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
