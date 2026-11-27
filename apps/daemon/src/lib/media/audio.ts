// Music and sound (BAZ-095): a song, a jingle or background music from a prompt (and lyrics), or a
// sound effect, through the chosen route. ElevenLabs makes both; Lyria makes music. Endpoints and
// fields as each provider documented them on 2026-11-27.

import type { AudioRouteDef, ChosenRoute } from '../../core/media-routes.ts'
import { type Fetch, mediaType, okBytes, okJson } from './http.ts'

export type AudioKind = 'music' | 'sound'

export interface AudioRequest {
  kind: AudioKind
  prompt: string
  /** Words to sing, for music. */
  lyrics?: string
  /** Music without voices. */
  instrumental?: boolean
  /** How long, when the model takes a length. */
  seconds?: number
  /** A sound effect that loops seamlessly. */
  loop?: boolean
}

/** The lengths each route takes, in seconds, from its provider's documentation. */
export const AUDIO_LENGTHS: Record<
  AudioRouteDef['id'],
  Partial<Record<AudioKind, { least: number; most: number }>>
> = {
  'elevenlabs:music_v2_5': { music: { least: 3, most: 600 }, sound: { least: 0.5, most: 30 } },
  // Lyria takes its length from the prompt, not from a field.
  'google:lyria-3.5': {},
}

type Ready = Extract<ChosenRoute<AudioRouteDef>, { ready: true }>

export interface MadeAudio {
  bytes: Buffer
  mimeType: string
  extension: string
  /** What the model wrote beside the sound (Lyria's lyrics), if anything. */
  words?: string
}

export function checkAudioRequest(route: AudioRouteDef, request: AudioRequest): void {
  if (!(route.makes as readonly AudioKind[]).includes(request.kind))
    throw new Error(`${route.model} makes ${route.makes.join(' and ')}, not ${request.kind}`)
  const range = AUDIO_LENGTHS[route.id][request.kind]
  if (request.seconds !== undefined && range) {
    if (!(request.seconds >= range.least && request.seconds <= range.most))
      throw new Error(
        `${route.model} makes ${request.kind} of ${range.least} to ${range.most} seconds`,
      )
  }
}

function asAudio(bytes: Buffer, model: string, words?: string): MadeAudio {
  const type = mediaType(bytes)
  if (!type?.mimeType.startsWith('audio/')) throw new Error(`${model} returned no audio`)
  return { bytes, ...type, ...(words ? { words } : {}) }
}

/** The prompt with what Lyria takes in words: the length, no voices, the lyrics. */
function lyriaPrompt(request: AudioRequest): string {
  return [
    request.prompt,
    request.seconds !== undefined ? `Length: about ${request.seconds} seconds.` : '',
    request.instrumental ? 'Instrumental only, no vocals.' : '',
    request.lyrics ? `Lyrics:\n${request.lyrics}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function generateAudio(
  chosen: Ready,
  request: AudioRequest,
  options: { fetch?: Fetch; signal?: AbortSignal } = {},
): Promise<MadeAudio> {
  checkAudioRequest(chosen.route, request)
  const fetchImpl = options.fetch ?? fetch
  const { signal } = options
  const model = chosen.route.model
  switch (chosen.route.provider) {
    case 'elevenlabs': {
      const headers = { 'xi-api-key': chosen.apiKey, 'content-type': 'application/json' }
      const music = request.kind === 'music'
      const url = music
        ? 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128'
        : 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'
      const body = music
        ? {
            prompt: request.lyrics
              ? `${request.prompt}\n\nLyrics:\n${request.lyrics}`
              : request.prompt,
            model_id: chosen.modelId,
            force_instrumental: request.instrumental === true,
            ...(request.seconds !== undefined
              ? { music_length_ms: Math.round(request.seconds * 1000) }
              : {}),
          }
        : {
            text: request.prompt,
            model_id: 'eleven_text_to_sound_v3',
            duration_seconds: request.seconds ?? null,
            loop: request.loop === true,
          }
      return asAudio(
        await okBytes(
          await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
          }),
          model,
        ),
        model,
      )
    }
    case 'google': {
      const body = await okJson<{
        candidates?: {
          content?: { parts?: { text?: string; inlineData?: { data?: string } }[] }
        }[]
      }>(
        await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosen.modelId)}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': chosen.apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: lyriaPrompt(request) }] }],
              generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
            }),
            ...(signal ? { signal } : {}),
          },
        ),
        model,
      )
      const parts = body.candidates?.[0]?.content?.parts ?? []
      const audio = parts.find((part) => part.inlineData?.data)?.inlineData?.data
      if (!audio) throw new Error(`${model} returned no audio`)
      const words = parts
        .map((part) => part.text?.trim())
        .filter(Boolean)
        .join('\n')
      return asAudio(Buffer.from(audio, 'base64'), model, words)
    }
  }
}
