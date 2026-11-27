// BAZILION_TRANSCRIPTION_MODEL selects how voice notes and audio you send are turned into words
// before the turn: off, or one speech-to-text model through one account.

/** Every way to transcribe: a model, the provider whose account it runs on, who pays. */
export const TRANSCRIPTION_ROUTES = [
  {
    id: 'openai:gpt-transcribe',
    model: 'GPT Transcribe',
    provider: 'openai',
    label: 'GPT Transcribe · OpenAI API key',
    billing: 'Billed per minute of audio by OpenAI',
  },
] as const

export type TranscriptionRouteDef = (typeof TRANSCRIPTION_ROUTES)[number]

const ROUTE_KEY = { openai: 'OPENAI_API_KEY' } as const

/** What a route still needs, in a few words; null when it is ready. */
export function transcriptionRouteNeeds(
  route: TranscriptionRouteDef,
  env: NodeJS.ProcessEnv,
): string | null {
  return env[ROUTE_KEY[route.provider]]?.trim() ? null : 'an OpenAI API key'
}

export type TranscriptionRoute =
  | { ready: true; model: string; label: string; modelId: string; apiKey: string }
  | { ready: false; reason: string }

export function transcriptionRoute(env: NodeJS.ProcessEnv): TranscriptionRoute {
  const model = env.BAZILION_TRANSCRIPTION_MODEL?.trim() || 'off'
  if (model === 'off') return { ready: false, reason: 'Voice notes are not transcribed.' }
  const route = TRANSCRIPTION_ROUTES.find(({ id }) => id === model)
  if (!route) return { ready: false, reason: `Unknown transcription model "${model}".` }
  const key = ROUTE_KEY[route.provider]
  const apiKey = env[key]?.trim()
  return apiKey
    ? {
        ready: true,
        model,
        label: route.model,
        modelId: model.slice(model.indexOf(':') + 1),
        apiKey,
      }
    : { ready: false, reason: `${model} needs ${key}.` }
}
