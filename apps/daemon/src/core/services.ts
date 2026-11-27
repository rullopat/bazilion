// The settings Setup (`/config`) and `bazilion config` know.
//
// Each entry is one thing the user may set up: an LLM provider (from the provider table in
// providers.ts), a model function (image generation), a tool (web search, the browser, …) or an
// integration (Telegram). A field knows where it is stored (`secret`: the encrypted `secrets`
// table, `config`: the plaintext `config` table) and how it is entered and checked (`input`).
// The registry is the single source of truth for the Tools page, for `bazilion config` and for
// the field-write endpoints.

import { IMAGE_ROUTES } from './image-generation-config.ts'
import { AUDIO_ROUTES, SPEECH_ROUTES, VIDEO_ROUTES } from './media-routes.ts'
import { PROVIDERS } from './providers.ts'
import { TRANSCRIPTION_ROUTES } from './transcription-config.ts'

export type FieldKind = 'secret' | 'config'

export interface FieldOption {
  value: string
  label: string
  /** One line about what choosing it means. */
  hint?: string
}

/**
 * How a setting is entered and checked. Whatever the input, the stored value is text, the same
 * text the daemon's environment could carry under the field's name.
 */
export type FieldInput =
  /** Free text; `format` is checked when it is saved. */
  | { type: 'text'; format?: 'url' | 'path' | 'docker-image' | 'model' }
  | { type: 'choice'; options: readonly FieldOption[]; default: string }
  /** Stored as `on` or `off`; `default` is the position when nothing is stored. */
  | { type: 'switch'; on: string; off: string; default: boolean }
  /** A whole number in its base unit; people see it divided by `scale`, in `unit`. */
  | { type: 'number'; default: number; min: number; max: number; unit?: string; scale?: number }

export interface ServiceField {
  /** Env var name — canonical key in both stores. */
  envVar: string
  kind: FieldKind
  label: string
  placeholder?: string
  description?: string
  /** Free text when left out. */
  input?: FieldInput
  /** A field most installations never set; shown under "More settings". */
  advanced?: boolean
  /** It matters only while these other fields of its card have one of these values. */
  when?: readonly { envVar: string; is: readonly string[] }[]
}

/**
 * `function` is a model function with its own place on the Models page (image generation);
 * `tool` is a card on the Tools page.
 */
export type ServiceCategory = 'provider' | 'function' | 'tool' | 'integration'

export interface ServiceDef {
  /** For providers, the provider id (e.g. 'anthropic'). */
  id: string
  displayName: string
  category: ServiceCategory
  /** One line under the name: what it is for. */
  hint?: string
  /** Something worth knowing that is not a setting of the card. */
  footnote?: string
  fields: ServiceField[]
}

const yesNo = (fallback: boolean): FieldInput => ({
  type: 'switch',
  on: 'true',
  off: 'false',
  default: fallback,
})

const BROWSER_ON = { envVar: 'BROWSER_ENABLED', is: ['true'] } as const
const OWN_BROWSER = { envVar: 'BROWSER_ATTACH', is: ['false'] } as const
const RUNNING_BROWSER = { envVar: 'BROWSER_ATTACH', is: ['true'] } as const

/** Order here is the display order on the Tools page and in `bazilion config list`. */
export const SERVICES: ServiceDef[] = [
  // LLM providers: one entry per row of the provider table.
  ...PROVIDERS.map(
    ({ id, displayName, hint, fields }): ServiceDef => ({
      id,
      displayName,
      category: 'provider',
      ...(hint ? { hint } : {}),
      fields,
    }),
  ),

  // --- Model functions ---
  {
    id: 'image-generation',
    displayName: 'Image generation',
    // Chosen under Images on the Models page; the field is here for `bazilion config`.
    category: 'function',
    hint: 'The image_generate tool: images are saved to Team Results. At most four image_generate calls per turn.',
    fields: [
      {
        envVar: 'BAZILION_IMAGE_MODEL',
        kind: 'config',
        label: 'Image model',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Off' },
            ...IMAGE_ROUTES.map((route) => ({ value: route.id, label: route.label })),
          ],
        },
        description:
          'Off by default. API-key routes are billed per image; the ChatGPT sign-in uses your subscription.',
      },
    ],
  },

  {
    id: 'video-generation',
    displayName: 'Video',
    // Chosen under Video on the Models page; the field is here for `bazilion config`.
    category: 'function',
    hint: 'The video_generate tool: short clips with sound, saved to Team Results.',
    fields: [
      {
        envVar: 'BAZILION_VIDEO_MODEL',
        kind: 'config',
        label: 'Video model',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Off' },
            ...VIDEO_ROUTES.map((route) => ({ value: route.id, label: route.label })),
          ],
        },
        description: 'Off by default. Billed per second or per video by the provider.',
      },
    ],
  },

  {
    id: 'audio-generation',
    displayName: 'Music and sound',
    // Chosen under Music and sound on the Models page; the field is here for `bazilion config`.
    category: 'function',
    hint: 'The audio_generate tool: songs, background music and sound effects, saved to Team Results.',
    fields: [
      {
        envVar: 'BAZILION_AUDIO_MODEL',
        kind: 'config',
        label: 'Music and sound model',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Off' },
            ...AUDIO_ROUTES.map((route) => ({ value: route.id, label: route.label })),
          ],
        },
        description: 'Off by default. Billed per song or in credits by the provider.',
      },
    ],
  },

  {
    id: 'speech',
    displayName: 'Speech',
    // Chosen under Speech on the Models page; the fields are here for `bazilion config`.
    category: 'function',
    hint: 'The speak tool, Read aloud in the web chat, and voice replies to voice notes on Telegram.',
    fields: [
      {
        envVar: 'BAZILION_SPEECH_MODEL',
        kind: 'config',
        label: 'Speech model',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Off' },
            ...SPEECH_ROUTES.map((route) => ({ value: route.id, label: route.label })),
          ],
        },
        description: 'Off by default. Billed per character by the provider.',
      },
      {
        envVar: 'BAZILION_SPEECH_VOICE',
        kind: 'config',
        label: 'Voice',
        input: { type: 'text' },
        description:
          "The voice's id, as the speech model's provider lists it (the Speech card shows them). Empty: the model's first voice.",
      },
    ],
  },

  {
    id: 'transcription',
    displayName: 'Transcription',
    // Chosen under Transcription on the Models page; the field is here for `bazilion config`.
    category: 'function',
    hint: 'Voice notes and audio you send, turned into words before the turn.',
    fields: [
      {
        envVar: 'BAZILION_TRANSCRIPTION_MODEL',
        kind: 'config',
        label: 'Transcription model',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Off' },
            ...TRANSCRIPTION_ROUTES.map((route) => ({ value: route.id, label: route.label })),
          ],
        },
        description:
          'Off by default: an Agent then gets the audio file without its words. Billed per minute of audio.',
      },
    ],
  },

  {
    id: 'command-review',
    displayName: 'Command review',
    // Chosen under Command review on the Models page; the field is here for `bazilion config`.
    category: 'function',
    hint: 'The model that answers first for dangerous commands, when Commands asks it to.',
    fields: [
      {
        envVar: 'BAZILION_COMMAND_REVIEW_MODEL',
        kind: 'config',
        label: 'Review model',
        placeholder: 'anthropic:claude-haiku-4-5',
        description: 'A model in Chat, as provider:model. Without one, the owner answers.',
        input: { type: 'text', format: 'model' },
      },
    ],
  },

  // --- Tools: what Agents can do besides thinking ---
  {
    id: 'web-search',
    displayName: 'Web search',
    category: 'tool',
    hint: 'Where an Agent’s searches go.',
    footnote: 'Applies to every Agent, in every kind of turn.',
    fields: [
      {
        envVar: 'BAZILION_WEB_SEARCH_ROUTE',
        kind: 'config',
        label: 'Search with',
        input: {
          type: 'choice',
          default: 'auto',
          options: [
            {
              value: 'auto',
              label: 'Automatic',
              hint: 'The first that is set up: Brave, SearXNG, Tavily, Exa, then the model’s own search.',
            },
            {
              value: 'brave',
              label: 'Brave Search',
              hint: 'Needs the key below. Free tier at brave.com/search/api.',
            },
            {
              value: 'searxng',
              label: 'SearXNG',
              hint: 'Your own instance, at the address below.',
            },
            {
              value: 'tavily',
              label: 'Tavily',
              hint: 'Needs the key below. Search made for Agents; free tier at tavily.com.',
            },
            {
              value: 'exa',
              label: 'Exa',
              hint: 'Needs the key below. Search by meaning; free credits at exa.ai.',
            },
            {
              value: 'native',
              label: 'The model’s own search',
              hint: 'Only Agents on OpenAI or ChatGPT models can search.',
            },
            { value: 'off', label: 'Off', hint: 'Agents cannot search the web.' },
          ],
        },
      },
      { envVar: 'BRAVE_API_KEY', kind: 'secret', label: 'Brave API key', placeholder: 'BSA…' },
      { envVar: 'TAVILY_API_KEY', kind: 'secret', label: 'Tavily API key', placeholder: 'tvly-…' },
      { envVar: 'EXA_API_KEY', kind: 'secret', label: 'Exa API key' },
      {
        envVar: 'SEARXNG_URL',
        kind: 'config',
        label: 'SearXNG address',
        placeholder: 'https://searxng.example.com',
        input: { type: 'text', format: 'url' },
      },
    ],
  },
  {
    id: 'web-pages',
    displayName: 'Web pages',
    category: 'tool',
    hint: 'How an Agent reads a page it was given or found. The built-in reader is always on and needs no account.',
    fields: [
      {
        envVar: 'FIRECRAWL_API_KEY',
        kind: 'secret',
        label: 'Firecrawl API key',
        placeholder: 'fc-…',
        description:
          'Optional, for pages that need JavaScript: used only when the built-in reader gets too little text. Free tier at firecrawl.dev.',
      },
      {
        envVar: 'FIRECRAWL_URL',
        kind: 'config',
        label: 'Firecrawl address',
        placeholder: 'https://api.firecrawl.dev',
        description: 'Only for a Firecrawl you host yourself.',
        input: { type: 'text', format: 'url' },
        advanced: true,
      },
    ],
  },
  {
    id: 'browser',
    displayName: 'Browser',
    category: 'tool',
    hint: 'Lets an Agent open pages, click, fill forms and stay logged in.',
    footnote: 'Each Agent’s browser is stopped and reset under Browser in its Agent tab.',
    fields: [
      {
        envVar: 'BROWSER_ENABLED',
        kind: 'config',
        label: 'Agents can use a browser',
        input: yesNo(true),
      },
      {
        envVar: 'BROWSER_ATTACH',
        kind: 'config',
        label: 'Which browser',
        when: [BROWSER_ON],
        input: {
          type: 'choice',
          default: 'false',
          options: [
            {
              value: 'false',
              label: 'A browser of its own for each Agent',
              hint: 'Its logins are kept apart from yours and from other Agents.',
            },
            {
              value: 'true',
              label: 'My running Chrome',
              hint: 'Agents work in your Chrome or Chromium, with your logins, in tabs of their own. Allow it first at chrome://inspect/#remote-debugging.',
            },
          ],
        },
      },
      {
        envVar: 'BROWSER_HEADLESS',
        kind: 'config',
        label: 'Show the browser window',
        description: 'Off: it works out of sight. Not used with your running Chrome.',
        // The setting is "headless": the window shows when it is false.
        input: { type: 'switch', on: 'false', off: 'true', default: false },
        advanced: true,
        when: [BROWSER_ON, OWN_BROWSER],
      },
      {
        envVar: 'BROWSER_ALLOW_PRIVATE_NETWORK',
        kind: 'config',
        label: 'Reach addresses on your own network',
        description: 'Off is safer. On is for local development only.',
        input: yesNo(false),
        advanced: true,
        when: [BROWSER_ON],
      },
      {
        envVar: 'BROWSER_IDLE_MS',
        kind: 'config',
        label: 'Close an idle browser after',
        input: {
          type: 'number',
          default: 900_000,
          min: 60_000,
          max: 86_400_000,
          unit: 'minutes',
          scale: 60_000,
        },
        advanced: true,
        when: [BROWSER_ON],
      },
      {
        envVar: 'BROWSER_MAX_SESSIONS',
        kind: 'config',
        label: 'Browsers open at the same time',
        input: { type: 'number', default: 4, min: 1, max: 64, unit: 'at most' },
        advanced: true,
        when: [BROWSER_ON],
      },
      {
        envVar: 'BROWSER_EXECUTABLE_PATH',
        kind: 'config',
        label: 'Browser program',
        placeholder: '/usr/bin/brave-browser',
        description:
          'A Chromium-family browser to use. Left empty, Bazilion uses the first installed Chrome, Brave, Edge or Chromium, and downloads Chromium once when there is none.',
        input: { type: 'text', format: 'path' },
        advanced: true,
        when: [BROWSER_ON, OWN_BROWSER],
      },
      {
        envVar: 'BROWSER_ATTACH_URL',
        kind: 'config',
        label: 'Address of the running browser',
        placeholder: 'http://127.0.0.1:9222',
        description:
          'For a browser started with --remote-debugging-port. Left empty, Bazilion finds the running Chrome or Chromium itself.',
        input: { type: 'text', format: 'url' },
        advanced: true,
        when: [BROWSER_ON, RUNNING_BROWSER],
      },
    ],
  },
  {
    id: 'commands',
    displayName: 'Commands',
    category: 'tool',
    hint: 'Where an Agent’s shell commands run, and what it must ask first.',
    footnote: 'A Team can name a Docker image of its own in its settings.',
    fields: [
      {
        envVar: 'BAZILION_BASH_SANDBOX',
        kind: 'config',
        label: 'Commands run',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            {
              value: 'off',
              label: 'On this computer',
              hint: 'No isolation: a command can reach whatever you can.',
            },
            {
              value: 'docker',
              label: 'In a Docker container',
              hint: 'A fresh container with no network for every command.',
            },
          ],
        },
      },
      {
        envVar: 'BAZILION_BASH_APPROVAL',
        kind: 'config',
        label: 'Dangerous commands',
        description:
          'A rule you keep for an Agent (Always for this Agent) allows its commands without asking. When nobody can answer (a schedule, Telegram, an inbox wake), what would ask you is denied.',
        input: {
          type: 'choice',
          default: 'off',
          options: [
            { value: 'off', label: 'Run them', hint: 'No command asks first.' },
            {
              value: 'dangerous',
              label: 'Ask me first',
              hint: 'You allow or deny each one in the chat, on Telegram or in Attention.',
            },
            {
              value: 'review',
              label: 'A review model first',
              hint: 'The Command review model on the Models page allows, refuses or asks you.',
            },
          ],
        },
      },
      {
        envVar: 'BAZILION_BASH_SANDBOX_IMAGE',
        kind: 'config',
        label: 'Docker image',
        placeholder: 'debian:bookworm-slim',
        description:
          'A local image with /bin/bash. Bazilion never pulls it and never falls back to this computer. A Team can name its own.',
        input: { type: 'text', format: 'docker-image' },
        advanced: true,
        when: [{ envVar: 'BAZILION_BASH_SANDBOX', is: ['docker'] }],
      },
    ],
  },

  // --- External integrations (chat bridges, etc) ---
  // Telegram has its own page (`/config/telegram`) with its own flow (preflight, pairing, …).
  // The fields are here so that the keys are known to the stores and to
  // `PUT /api/config/fields/:envVar`.
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
