// Per-service field registry — the shape of the /config page.
//
// Each entry describes one "thing" the user might configure: an LLM provider
// (from the provider table in providers.ts) or an ancillary service (Brave
// Search, SearXNG, …). Fields know which storage backend they live in:
// `secret` → the encrypted `secrets` table, `config` → the plaintext `config`
// table. The registry is the single source of truth for the UI layout and for
// the generic field-write endpoint's dispatch.

import { IMAGE_MODEL_CHOICES } from './image-generation-config.ts'
import { PROVIDERS } from './providers.ts'

export type FieldKind = 'secret' | 'config'

export interface ServiceField {
  /** Env var name — canonical key in both stores. */
  envVar: string
  kind: FieldKind
  label: string
  placeholder?: string
  description?: string
  options?: readonly string[]
  optionLabels?: Readonly<Record<string, string>>
}

export type ServiceCategory = 'provider' | 'service' | 'integration'

export interface ServiceDef {
  /** For providers, the provider id (e.g. 'anthropic'). */
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
  // LLM providers: one card per entry of the provider table.
  ...PROVIDERS.map(
    ({ id, displayName, hint, fields }): ServiceDef => ({
      id,
      displayName,
      category: 'provider',
      ...(hint ? { hint } : {}),
      fields,
    }),
  ),

  // --- Ancillary services (web search, etc) ---
  {
    id: 'web-search',
    displayName: 'Web search',
    category: 'service',
    team: 'Web Search',
    hint: 'The web_search tool of every Agent turn. Auto uses Brave when BRAVE_API_KEY is set, else SearXNG when SEARXNG_URL is set, else the search hosted by an Agent on an OpenAI (API key) or ChatGPT model.',
    fields: [
      {
        envVar: 'BAZILION_WEB_SEARCH_ROUTE',
        kind: 'config',
        label: 'Search backend',
        options: ['auto', 'brave', 'searxng', 'native', 'off'],
        description:
          'auto (default), brave, searxng, native (the Agent’s own OpenAI or ChatGPT model) or off. A chosen backend that is not configured leaves Agents without web_search.',
      },
    ],
  },
  {
    id: 'image-generation',
    displayName: 'Image generation',
    category: 'service',
    team: 'Content tools',
    hint: 'The image_generate tool: images are saved to Team Results. At most four image_generate calls per turn.',
    fields: [
      {
        envVar: 'BAZILION_IMAGE_MODEL',
        kind: 'config',
        label: 'Image model',
        options: IMAGE_MODEL_CHOICES,
        optionLabels: {
          off: 'Off',
          'openai-codex:gpt-image-2': 'GPT Image 2 · ChatGPT login',
          'openai:gpt-image-2': 'GPT Image 2 · OpenAI API key',
          'openrouter:google/gemini-3.1-flash-image': 'Gemini 3.1 Flash Image · OpenRouter',
          'openrouter:openai/gpt-image-2': 'GPT Image 2 · OpenRouter',
        },
        description:
          'Off by default. API-key routes are billed per image; the ChatGPT login uses your subscription.',
      },
    ],
  },
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
    id: 'shell-security',
    displayName: 'Agent Shell Security',
    category: 'service',
    team: 'Agent Runtime',
    hint: 'Applies to every Agent turn, whatever its origin. Host execution is unisolated.',
    fields: [
      {
        envVar: 'BAZILION_BASH_APPROVAL',
        kind: 'config',
        label: 'Dangerous-command approval',
        placeholder: 'off',
        description:
          'Use off or dangerous (classified commands require per-call approval). Unattended turns auto-deny; interactive turns may approve once.',
      },
      {
        envVar: 'BAZILION_BASH_SANDBOX',
        kind: 'config',
        label: 'Sandbox mode',
        placeholder: 'off',
        options: ['off', 'docker'],
        description:
          'Use off for unisolated host tools or docker (bash runs in a fresh network-disabled container; host file tools are hidden). Applies to every turn origin.',
      },
      {
        envVar: 'BAZILION_BASH_SANDBOX_IMAGE',
        kind: 'config',
        label: 'Docker image',
        placeholder: 'debian:bookworm-slim',
        description:
          'Local image with /bin/bash; Bazilion never pulls it and never falls back to host execution. A Team can name its own.',
      },
      {
        envVar: 'BAZILION_AGENT_LOOP_MAX_HOPS',
        kind: 'config',
        label: 'Agent-message hop limit',
        placeholder: '8',
        description:
          'Maximum causal hops in an agent-to-agent message chain before the daemon stops it. Default 8.',
      },
    ],
  },
  {
    id: 'browser',
    displayName: 'Browser Automation',
    category: 'service',
    team: 'Browser',
    hint: 'Each Agent gets its own persistent browser profile (cookies, logins), kept across turns and Team moves and excluded from backups. Reset on the Agent page, or deleting the Agent, removes it.',
    fields: [
      {
        envVar: 'BROWSER_ENABLED',
        kind: 'config',
        label: 'Enable browser tools',
        placeholder: 'true',
        description: 'Give Agent turns the browser_* tools (true/false). Default true.',
      },
      {
        envVar: 'BROWSER_EXECUTABLE_PATH',
        kind: 'config',
        label: 'Browser executable (optional)',
        placeholder: '/usr/bin/brave-browser',
        description:
          'Absolute path to a Chromium-family browser. When unset, Bazilion uses the first installed Chrome, Brave, Edge or Chromium, then the Chromium that Playwright downloaded.',
      },
      {
        envVar: 'BROWSER_HEADLESS',
        kind: 'config',
        label: 'Headless',
        placeholder: 'true',
        description:
          'true (default) runs the browser without a window; false opens a visible browser window on the desktop the daemon runs in.',
      },
      {
        envVar: 'BROWSER_ALLOW_PRIVATE_NETWORK',
        kind: 'config',
        label: 'Allow private network',
        placeholder: 'false',
        description:
          'Permit the browser to reach loopback/private IPs (SSRF guard off). Default false — only enable for local dev. Never enable for untrusted browsing.',
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
 * Fast lookup: envVar → the field definition.
 * Rebuilt once at module init — the list is static.
 */
const FIELD_INDEX: Map<string, ServiceField> = (() => {
  const m = new Map<string, ServiceField>()
  for (const service of SERVICES) {
    for (const field of service.fields) {
      m.set(field.envVar, field)
    }
  }
  return m
})()

export function findFieldByEnvVar(envVar: string): ServiceField | undefined {
  return FIELD_INDEX.get(envVar)
}

export function servicesByCategory(category: ServiceCategory): ServiceDef[] {
  return SERVICES.filter((s) => s.category === category)
}
