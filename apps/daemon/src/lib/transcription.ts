// Voice notes and audio you send, turned into words before the turn (BAZ-091). The daemon calls
// the chosen speech-to-text model; the turn's message then carries the words and the file's path.

import type { Attachment } from '@bazilion/api-types'
import type { TranscriptionRoute } from '../core/transcription-config.ts'
import { errorReason } from './media/http.ts'

/** What a speech-to-text endpoint takes, as OpenAI lists it: the file's ending decides. */
const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
}

export function isAudio(file: Pick<Attachment, 'mimeType'>): boolean {
  return file.mimeType.toLowerCase().startsWith('audio/')
}

/** A file name the endpoint reads the format from. */
function fileName(file: Attachment): string {
  const ext = EXTENSIONS[file.mimeType.toLowerCase().split(';')[0]?.trim() ?? '']
  const given = file.name?.trim()
  if (given && /\.[a-z0-9]{2,5}$/i.test(given)) return given
  return `${given || 'audio'}.${ext ?? 'ogg'}`
}

type Fetch = typeof fetch

type Ready = Extract<TranscriptionRoute, { ready: true }>

/** Audio to transcribe: its bytes, its type, and a name whose ending says its format. */
export interface AudioFile {
  bytes: Buffer
  mimeType: string
  name: string
}

/** The words, and, when asked for and the model gives them, each line with when it starts. */
export interface Transcript {
  text: string
  lines?: { start: number; text: string }[]
}

/** A word-by-word answer becomes lines: a new one after a sentence ends or a pause. */
const PAUSE_SECONDS = 1
function linesOf(words: readonly { text: string; start: number; end?: number }[]) {
  const lines: { start: number; text: string }[] = []
  let current: { start: number; text: string } | null = null
  let lastEnd = 0
  for (const word of words) {
    const piece = word.text
    if (!piece.trim()) {
      if (current) current.text += piece
      continue
    }
    if (!current || word.start - lastEnd >= PAUSE_SECONDS) {
      if (current) lines.push(current)
      current = { start: word.start, text: piece.trimStart() }
    } else current.text += /^\s/.test(piece) || /\s$/.test(current.text) ? piece : ` ${piece}`
    lastEnd = word.end ?? word.start
    if (/[.!?…]["')\]]?$/.test(piece.trim())) {
      lines.push(current)
      current = null
    }
  }
  if (current) lines.push(current)
  return lines.map((line) => ({ start: line.start, text: line.text.trim() })).filter((l) => l.text)
}

const seconds = (offset: unknown) =>
  typeof offset === 'number'
    ? offset
    : Number.parseFloat(String(offset ?? '0').replace(/s$/, '')) || 0

/** The form fields, and the file last (xAI reads it last), of a speech-to-text request. */
function form(fields: [string, string][], file: AudioFile): FormData {
  const body = new FormData()
  for (const [name, value] of fields) body.append(name, value)
  body.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name)
  return body
}

async function answer<T>(response: Response, label: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as T | null
  if (!response.ok) {
    const reason = errorReason(body)
    throw new Error(`${response.status}${reason ? `: ${reason}` : ''}`)
  }
  if (!body) throw new Error(`${label} gave no answer`)
  return body
}

/** The words of one audio (or video) file; throws with the provider's own reason. */
export async function transcribeAudio(
  route: Ready,
  file: AudioFile,
  options: { signal?: AbortSignal; fetchImpl?: Fetch; timed?: boolean } = {},
): Promise<Transcript> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal ? { signal: options.signal } : {}
  const bearer = { authorization: `Bearer ${route.apiKey}` }
  const post = (url: string, init: RequestInit) =>
    fetchImpl(url, { method: 'POST', ...init, ...signal })
  type Segments = { text?: string; segments?: { start?: number; text?: string }[] }
  const fromSegments = (body: Segments): Transcript => ({
    text: String(body.text ?? '').trim(),
    ...(options.timed && body.segments?.length
      ? {
          lines: body.segments
            .map((segment) => ({
              start: segment.start ?? 0,
              text: String(segment.text ?? '').trim(),
            }))
            .filter((line) => line.text),
        }
      : {}),
  })
  switch (route.provider) {
    case 'openai': {
      // gpt-transcribe gives no times.
      const body = await answer<{ text?: unknown }>(
        await post('https://api.openai.com/v1/audio/transcriptions', {
          headers: bearer,
          body: form([['model', route.modelId]], file),
        }),
        route.label,
      )
      if (typeof body.text !== 'string') throw new Error('the answer had no text')
      return { text: body.text.trim() }
    }
    case 'groq':
      return fromSegments(
        await answer<Segments>(
          await post('https://api.groq.com/openai/v1/audio/transcriptions', {
            headers: bearer,
            body: form(
              [
                ['model', route.modelId],
                ['response_format', options.timed ? 'verbose_json' : 'json'],
                ...(options.timed
                  ? ([['timestamp_granularities[]', 'segment']] as [string, string][])
                  : []),
              ],
              file,
            ),
          }),
          route.label,
        ),
      )
    case 'mistral':
      return fromSegments(
        await answer<Segments>(
          await post('https://api.mistral.ai/v1/audio/transcriptions', {
            headers: bearer,
            body: form(
              [
                ['model', route.modelId],
                ...(options.timed
                  ? ([['timestamp_granularities', 'segment']] as [string, string][])
                  : []),
              ],
              file,
            ),
          }),
          route.label,
        ),
      )
    case 'xai': {
      const body = await answer<{
        text?: string
        words?: { text?: string; start?: number; end?: number }[]
      }>(
        await post('https://api.x.ai/v1/stt', {
          headers: bearer,
          body: form([['model', route.modelId]], file),
        }),
        route.label,
      )
      const words = (body.words ?? []).map((word) => ({
        text: ` ${String(word.text ?? '')}`,
        start: word.start ?? 0,
        ...(word.end !== undefined ? { end: word.end } : {}),
      }))
      return {
        text: String(body.text ?? '').trim(),
        ...(options.timed && words.length ? { lines: linesOf(words) } : {}),
      }
    }
    case 'elevenlabs': {
      const body = await answer<{
        text?: string
        words?: { text?: string; type?: string; start?: number; end?: number }[]
      }>(
        await post('https://api.elevenlabs.io/v1/speech-to-text', {
          headers: { 'xi-api-key': route.apiKey },
          body: form(
            [
              ['model_id', route.modelId],
              ['timestamps_granularity', options.timed ? 'word' : 'none'],
            ],
            file,
          ),
        }),
        route.label,
      )
      const words = (body.words ?? [])
        .filter((word) => word.type !== 'audio_event')
        .map((word) => ({
          text: String(word.text ?? ''),
          start: word.start ?? 0,
          ...(word.end !== undefined ? { end: word.end } : {}),
        }))
      return {
        text: String(body.text ?? '').trim(),
        ...(options.timed && words.length ? { lines: linesOf(words) } : {}),
      }
    }
    case 'google': {
      const body = await answer<{
        candidates?: {
          content?: {
            parts?: {
              text?: string
              audioTranscription?: {
                text?: string
                words?: { word?: string; startOffset?: unknown; endOffset?: unknown }[]
              }
            }[]
          }
        }[]
      }>(
        await post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.modelId)}:generateContent`,
          {
            headers: { 'x-goog-api-key': route.apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inlineData: { mimeType: file.mimeType, data: file.bytes.toString('base64') },
                    },
                  ],
                },
              ],
              ...(options.timed
                ? { generationConfig: { audioTranscriptionConfig: { wordTimestamp: true } } }
                : {}),
            }),
          },
        ),
        route.label,
      )
      const parts = body.candidates?.[0]?.content?.parts ?? []
      const text = parts
        .map((part) => part.audioTranscription?.text ?? part.text ?? '')
        .join(' ')
        .trim()
      const words = parts.flatMap((part) =>
        (part.audioTranscription?.words ?? []).map((word) => ({
          text: String(word.word ?? ''),
          start: seconds(word.startOffset),
          end: seconds(word.endOffset),
        })),
      )
      return { text, ...(options.timed && words.length ? { lines: linesOf(words) } : {}) }
    }
  }
}

/** The words in one audio file you sent; throws with the endpoint's own reason. */
export async function transcribe(
  route: Extract<TranscriptionRoute, { ready: true }>,
  file: Attachment,
  options: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
): Promise<string> {
  const bytes = Buffer.from(file.data, 'base64')
  return (
    await transcribeAudio(route, { bytes, mimeType: file.mimeType, name: fileName(file) }, options)
  ).text
}

/** "[1:02] words" per line, or the text when there are no times. */
export function timedText(transcript: Transcript): string {
  if (!transcript.lines?.length) return transcript.text
  const clock = (at: number) => {
    const whole = Math.floor(at)
    const h = Math.floor(whole / 3600)
    const m = Math.floor((whole % 3600) / 60)
    const s = String(whole % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }
  return transcript.lines.map((line) => `[${clock(line.start)}] ${line.text}`).join('\n')
}

/**
 * The words of each audio file you sent, for the turn's message. A file that cannot be
 * transcribed says why; its path is in the message all the same.
 */
export async function transcriptNotes(
  route: TranscriptionRoute,
  files: readonly Attachment[],
  options: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
): Promise<string> {
  const audio = files.filter(isAudio)
  if (!route.ready || audio.length === 0) return ''
  const notes: string[] = []
  for (const file of audio) {
    const label = file.name?.trim() || 'a voice note'
    try {
      const words = await transcribe(route, file, options)
      notes.push(
        words
          ? `[${label}, transcribed by ${route.label}:]\n${words}`
          : `[${label}, transcribed by ${route.label}: no words in it]`,
      )
    } catch (error) {
      if (options.signal?.aborted) throw error
      notes.push(
        `[${label} could not be transcribed: ${error instanceof Error ? error.message : 'unknown error'}]`,
      )
    }
  }
  return notes.join('\n\n')
}
