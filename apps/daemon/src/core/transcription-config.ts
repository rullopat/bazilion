// BAZILION_TRANSCRIPTION_MODEL selects what turns speech into words: voice notes and audio you send
// (before the turn), dictation in the web chat, and the `transcribe` tool. Off, or one
// speech-to-text model through one account.

import { chosenRoute, type MediaRouteDef, mediaRouteNeeds } from './media-routes.ts'

const MB = 1000 * 1000

/**
 * Every way to transcribe: a model, the provider whose account it runs on, who pays, and the
 * largest file the provider takes (its documented upload limit; Mistral documents none).
 */
export const TRANSCRIPTION_ROUTES = [
  {
    id: 'openai:gpt-transcribe',
    model: 'GPT Transcribe',
    provider: 'openai',
    label: 'GPT Transcribe · OpenAI API key',
    billing: 'Billed per minute of audio by OpenAI',
    maxBytes: 25 * MB,
  },
  {
    id: 'google:gemini-3.5-transcribe',
    model: 'Gemini 3.5 Transcribe',
    provider: 'google',
    label: 'Gemini 3.5 Transcribe · Gemini API key',
    billing: 'Billed per minute of audio by Google',
    // Sent inline with the request, which Google takes up to 20 MB.
    maxBytes: 20 * MB,
  },
  {
    id: 'xai:grok-voice-transcribe-2.0',
    model: 'Grok Voice Transcribe 2.0',
    provider: 'xai',
    label: 'Grok Voice Transcribe 2.0 · xAI API key',
    billing: 'Billed per hour of audio by xAI',
    maxBytes: 500 * MB,
  },
  {
    id: 'groq:whisper-large-v3-turbo',
    model: 'Whisper Large v3 Turbo',
    provider: 'groq',
    label: 'Whisper Large v3 Turbo · Groq API key',
    billing: 'Billed per hour of audio by Groq',
    maxBytes: 25 * MB,
  },
  {
    id: 'mistral:voxtral-mini-transcribe-3',
    model: 'Voxtral Mini Transcribe 3',
    provider: 'mistral',
    label: 'Voxtral Mini Transcribe 3 · Mistral API key',
    billing: 'Billed per minute of audio by Mistral',
  },
  {
    id: 'elevenlabs:scribe_v3',
    model: 'Scribe v3',
    provider: 'elevenlabs',
    label: 'Scribe v3 · ElevenLabs API key',
    billing: 'Billed per hour of audio in ElevenLabs credits',
    maxBytes: 5000 * MB,
  },
] as const satisfies readonly (MediaRouteDef & { maxBytes?: number })[]

export type TranscriptionRouteDef = (typeof TRANSCRIPTION_ROUTES)[number]

/** What a route still needs, in a few words; null when it is ready. */
export function transcriptionRouteNeeds(
  route: TranscriptionRouteDef,
  env: NodeJS.ProcessEnv,
): string | null {
  return mediaRouteNeeds(route, env)
}

export type TranscriptionRoute =
  | {
      ready: true
      model: string
      label: string
      provider: TranscriptionRouteDef['provider']
      /** The largest file the provider takes, when it says. */
      maxBytes?: number
      modelId: string
      apiKey: string
    }
  | { ready: false; reason: string }

export function transcriptionRoute(env: NodeJS.ProcessEnv): TranscriptionRoute {
  const chosen = chosenRoute(
    TRANSCRIPTION_ROUTES,
    env.BAZILION_TRANSCRIPTION_MODEL,
    'Voice notes are not transcribed.',
    env,
  )
  if (!chosen.ready) return chosen
  return {
    ready: true,
    model: chosen.route.id,
    label: chosen.route.model,
    provider: chosen.route.provider,
    ...('maxBytes' in chosen.route ? { maxBytes: chosen.route.maxBytes } : {}),
    modelId: chosen.modelId,
    apiKey: chosen.apiKey,
  }
}
