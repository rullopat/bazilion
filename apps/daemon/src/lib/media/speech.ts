// Speech (BAZ-096): text read out in a voice of the chosen model, for `speak`, Read aloud in the web
// chat, and voice replies on Telegram. The voices are the provider's own list where it has one.
// Endpoints and fields as each provider documented them on 2026-11-27.

import type { SpeechVoice } from '@bazilion/api-types'
import type { ChosenRoute, SpeechRouteDef } from '../../core/media-routes.ts'
import { type Fetch, mediaType, okBytes, okJson, wavFromPcm } from './http.ts'

type Ready = Extract<ChosenRoute<SpeechRouteDef>, { ready: true }>

export interface Spoken {
  bytes: Buffer
  mimeType: string
  extension: string
}

/**
 * Gemini's prebuilt voices, as its speech guide lists them (2026-11-27); its API lists catalogue
 * voices of another kind, so these are kept here.
 */
const GEMINI_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const

/** Gemini's speech, when it comes without a header: 24 kHz, one channel, 16-bit. */
const GEMINI_PCM = { rate: 24_000, channels: 1 } as const

export interface SpeechOptions {
  fetch?: Fetch
  signal?: AbortSignal
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {})

/** The voices of the chosen model, in the provider's order. */
export async function listVoices(
  chosen: Ready,
  options: SpeechOptions = {},
): Promise<SpeechVoice[]> {
  const fetchImpl = options.fetch ?? fetch
  const model = chosen.route.model
  switch (chosen.route.provider) {
    case 'elevenlabs': {
      const voices: SpeechVoice[] = []
      let token: string | null = null
      // The list comes in pages; every page is read, however many voices the account has.
      do {
        const url = new URL('https://api.elevenlabs.io/v2/voices')
        url.searchParams.set('page_size', '100')
        url.searchParams.set('include_total_count', 'false')
        if (token) url.searchParams.set('next_page_token', token)
        const page: {
          voices?: { voice_id?: string; name?: string; category?: string }[]
          has_more?: boolean
          next_page_token?: string | null
        } = await okJson(
          await fetchImpl(url, {
            headers: { 'xi-api-key': chosen.apiKey },
            ...withSignal(options.signal),
          }),
          model,
        )
        for (const voice of page.voices ?? [])
          if (voice.voice_id)
            voices.push({
              id: voice.voice_id,
              name: voice.name ?? voice.voice_id,
              ...(voice.category ? { detail: voice.category } : {}),
            })
        token = page.has_more ? (page.next_page_token ?? null) : null
      } while (token)
      return voices
    }
    case 'google':
      return GEMINI_VOICES.map((name) => ({ id: name, name }))
    case 'xai': {
      const body = await okJson<{
        voices?: { voice_id?: string; name?: string; language?: string }[]
      }>(
        await fetchImpl('https://api.x.ai/v1/tts/voices', {
          headers: { authorization: `Bearer ${chosen.apiKey}` },
          ...withSignal(options.signal),
        }),
        model,
      )
      return (body.voices ?? []).flatMap((voice) =>
        voice.voice_id
          ? [
              {
                id: voice.voice_id,
                name: voice.name ?? voice.voice_id,
                ...(voice.language ? { detail: voice.language } : {}),
              },
            ]
          : [],
      )
    }
    case 'minimax': {
      const body = await okJson<{
        system_voice?: { voice_id?: string; voice_name?: string; description?: string[] }[]
        base_resp?: { status_code?: number; status_msg?: string }
      }>(
        await fetchImpl('https://api.minimax.io/v1/get_voice', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${chosen.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ voice_type: 'system' }),
          ...withSignal(options.signal),
        }),
        model,
      )
      minimaxOk(body.base_resp, model)
      return (body.system_voice ?? []).flatMap((voice) =>
        voice.voice_id
          ? [
              {
                id: voice.voice_id,
                name: voice.voice_name ?? voice.voice_id,
                ...(voice.description?.[0] ? { detail: voice.description[0] } : {}),
              },
            ]
          : [],
      )
    }
  }
}

/** MiniMax answers 200 with its own status: anything but 0 is a refusal. */
function minimaxOk(base: { status_code?: number; status_msg?: string } | undefined, model: string) {
  if (base && base.status_code !== undefined && base.status_code !== 0)
    throw new Error(`${model} answered ${base.status_code}: ${base.status_msg ?? 'refused'}`)
}

function asSpeech(bytes: Buffer, model: string): Spoken {
  const type = mediaType(bytes)
  if (!type?.mimeType.startsWith('audio/')) throw new Error(`${model} returned no audio`)
  return { bytes, ...type }
}

/** `text` read out in `voice` (the model's first voice when none is given). */
export async function synthesize(
  chosen: Ready,
  text: string,
  voice: string | undefined,
  options: SpeechOptions = {},
): Promise<Spoken> {
  const fetchImpl = options.fetch ?? fetch
  const model = chosen.route.model
  const words = text.trim()
  if (!words) throw new Error('There is nothing to say')
  const named = voice?.trim() || (await listVoices(chosen, options))[0]?.id
  if (!named) throw new Error(`${model} lists no voice`)
  switch (chosen.route.provider) {
    case 'elevenlabs':
      return asSpeech(
        await okBytes(
          await fetchImpl(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(named)}?output_format=mp3_44100_128`,
            {
              method: 'POST',
              headers: { 'xi-api-key': chosen.apiKey, 'content-type': 'application/json' },
              body: JSON.stringify({ text: words, model_id: chosen.modelId }),
              ...withSignal(options.signal),
            },
          ),
          model,
        ),
        model,
      )
    case 'google': {
      const body = await okJson<{
        candidates?: {
          content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }
        }[]
      }>(
        await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosen.modelId)}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': chosen.apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: words }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { voice: named } },
              },
            }),
            ...withSignal(options.signal),
          },
        ),
        model,
      )
      const audio = body.candidates?.[0]?.content?.parts?.find(
        (part) => part.inlineData?.data,
      )?.inlineData
      if (!audio?.data) throw new Error(`${model} returned no audio`)
      const bytes = Buffer.from(audio.data, 'base64')
      // A whole WAV file, or the samples alone (audio/L16, audio/pcm), which get the header they
      // lack. The type Gemini gives decides: samples can look like another format's first bytes.
      const type = audio.mimeType?.toLowerCase() ?? ''
      const wav =
        type.includes('wav') || (!type && bytes.subarray(0, 4).toString('latin1') === 'RIFF')
      const rate = Number(/rate=(\d+)/.exec(type)?.[1]) || GEMINI_PCM.rate
      return asSpeech(wav ? bytes : wavFromPcm(bytes, rate, GEMINI_PCM.channels), model)
    }
    case 'xai':
      return asSpeech(
        await okBytes(
          await fetchImpl('https://api.x.ai/v1/tts', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${chosen.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              text: words,
              voice_id: named,
              language: 'auto',
              output_format: { codec: 'mp3', sample_rate: 24_000, bit_rate: 128_000 },
            }),
            ...withSignal(options.signal),
          }),
          model,
        ),
        model,
      )
    case 'minimax': {
      const body = await okJson<{
        data?: { audio?: string } | null
        base_resp?: { status_code?: number; status_msg?: string }
      }>(
        await fetchImpl('https://api.minimax.io/v1/t2a_v2', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${chosen.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: chosen.modelId,
            text: words,
            stream: false,
            output_format: 'hex',
            voice_setting: { voice_id: named, speed: 1, vol: 1, pitch: 0 },
            audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 },
          }),
          ...withSignal(options.signal),
        }),
        model,
      )
      minimaxOk(body.base_resp, model)
      if (!body.data?.audio) throw new Error(`${model} returned no audio`)
      return asSpeech(Buffer.from(body.data.audio, 'hex'), model)
    }
  }
}

/**
 * What of a Markdown message is read out: its prose. Code blocks and tables are left out, and
 * links, pictures and emphasis are read as their words.
 */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .replace(/~~~[\s\S]*?(~~~|$)/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line) && !/^\s*[-:| ]{3,}\s*$/.test(line))
    .join('\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
