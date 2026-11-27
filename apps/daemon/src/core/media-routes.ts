// What Agents make and hear besides text and pictures (BAZ-095, BAZ-096): one setting per function
// chooses a model and the account that pays for it, or `off`. Every route runs on a provider's API
// key, read where the provider's own entry says (`keyEnv`).
//
// Checked against the providers' documentation on 2026-11-27. Left out on purpose: OpenAI's Sora
// (shut down 2026-09-24), OpenAI's /v1/audio/speech (every model shut down 2027-01-06), Google's
// Veo on the Gemini API (shut down 2026-10-22; Gemini Omni Flash took its place) and MiniMax
// music (closed to new users since 2026-08-20).

import { findProvider } from './providers.ts'

type Env = Readonly<Record<string, string | undefined>>

export interface MediaRouteDef {
  /** The setting's value: `provider:model`. */
  id: string
  /** The model's name, as the card shows it. */
  model: string
  /** The provider whose API key it runs on (its id in providers.ts). */
  provider: string
  label: string
  billing: string
}

/** Videos (`video_generate`). Each makes a short clip with sound from a prompt or a picture. */
export const VIDEO_ROUTES = [
  {
    id: 'xai:grok-imagine-video-1.5',
    model: 'Grok Imagine Video 1.5',
    provider: 'xai',
    label: 'Grok Imagine Video 1.5 · xAI API key',
    billing: 'Billed per second of video by xAI',
  },
  {
    id: 'google:gemini-omni-1.2-flash',
    model: 'Gemini Omni Flash',
    provider: 'google',
    label: 'Gemini Omni Flash · Gemini API key',
    billing: 'Billed per second of video by Google',
  },
  {
    id: 'minimax:MiniMax-H3',
    model: 'MiniMax H3',
    provider: 'minimax',
    label: 'MiniMax H3 · MiniMax API key',
    billing: 'Billed per video by MiniMax',
  },
] as const satisfies readonly MediaRouteDef[]

/** Music and sound (`audio_generate`): what each route can make. */
export const AUDIO_ROUTES = [
  {
    id: 'elevenlabs:music_v2_5',
    model: 'ElevenLabs Music and Sound Effects',
    provider: 'elevenlabs',
    label: 'ElevenLabs Music and Sound Effects · ElevenLabs API key',
    billing: 'Billed in ElevenLabs credits',
    makes: ['music', 'sound'],
  },
  {
    id: 'google:lyria-3.5',
    model: 'Lyria 3.5',
    provider: 'google',
    label: 'Lyria 3.5 · Gemini API key',
    billing: 'Billed per song by Google',
    makes: ['music'],
  },
] as const satisfies readonly (MediaRouteDef & { makes: readonly ('music' | 'sound')[] })[]

/** Speech (`speak`, Read aloud, voice replies on Telegram). */
export const SPEECH_ROUTES = [
  {
    id: 'elevenlabs:eleven_v4',
    model: 'Eleven v4',
    provider: 'elevenlabs',
    label: 'Eleven v4 · ElevenLabs API key',
    billing: 'Billed per character in ElevenLabs credits',
  },
  {
    id: 'google:gemini-3.8-flash-tts',
    model: 'Gemini 3.8 Flash TTS',
    provider: 'google',
    label: 'Gemini 3.8 Flash TTS · Gemini API key',
    billing: 'Billed per token by Google',
  },
  {
    id: 'xai:tts',
    model: 'Grok Voice',
    provider: 'xai',
    label: 'Grok Voice · xAI API key',
    billing: 'Billed per character by xAI',
  },
  {
    id: 'minimax:speech-2.8-hd',
    model: 'MiniMax Speech 2.8 HD',
    provider: 'minimax',
    label: 'MiniMax Speech 2.8 HD · MiniMax API key',
    billing: 'Billed per character by MiniMax',
  },
] as const satisfies readonly MediaRouteDef[]

export type VideoRouteDef = (typeof VIDEO_ROUTES)[number]
export type AudioRouteDef = (typeof AUDIO_ROUTES)[number]
export type SpeechRouteDef = (typeof SPEECH_ROUTES)[number]

/** The provider's API key, as its own entry reads it: the first of its key variables set. */
export function providerKey(provider: string, env: Env): string | undefined {
  for (const name of findProvider(provider)?.keyEnv ?? []) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** What a route still needs, in a few words ("a Gemini API key"); null when it is ready. */
export function mediaRouteNeeds(route: MediaRouteDef, env: Env): string | null {
  if (providerKey(route.provider, env)) return null
  return `a ${findProvider(route.provider)?.displayName ?? route.provider} API key`
}

export type ChosenRoute<R extends MediaRouteDef> =
  | { ready: true; route: R; modelId: string; apiKey: string }
  | { ready: false; reason: string }

/** The route a setting chooses, with its key; `off` and a missing key say why not. */
export function chosenRoute<R extends MediaRouteDef>(
  routes: readonly R[],
  value: string | undefined,
  off: string,
  env: Env,
): ChosenRoute<R> {
  const chosen = value?.trim() || 'off'
  if (chosen === 'off') return { ready: false, reason: off }
  const route = routes.find(({ id }) => id === chosen)
  if (!route) return { ready: false, reason: `Unknown model "${chosen}".` }
  const apiKey = providerKey(route.provider, env)
  if (!apiKey) {
    const variable = findProvider(route.provider)?.keyEnv?.[0] ?? 'its API key'
    return { ready: false, reason: `${chosen} needs ${variable}.` }
  }
  return { ready: true, route, modelId: chosen.slice(chosen.indexOf(':') + 1), apiKey }
}

export const videoRoute = (env: Env) =>
  chosenRoute(VIDEO_ROUTES, env.BAZILION_VIDEO_MODEL, 'Video generation is off.', env)
export const audioRoute = (env: Env) =>
  chosenRoute(AUDIO_ROUTES, env.BAZILION_AUDIO_MODEL, 'Music and sound are off.', env)
export const speechRoute = (env: Env) =>
  chosenRoute(SPEECH_ROUTES, env.BAZILION_SPEECH_MODEL, 'Speech is off.', env)

/** Media models are chosen on their own cards, never as chat models. */
export function isMediaModel(provider: string, model: string): boolean {
  const id = `${provider}:${model}`
  return [...VIDEO_ROUTES, ...AUDIO_ROUTES, ...SPEECH_ROUTES].some((route) => route.id === id)
}
