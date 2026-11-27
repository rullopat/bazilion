// Voice notes and audio you send, turned into words before the turn (BAZ-091). The daemon calls
// the chosen speech-to-text model; the turn's message then carries the words and the file's path.

import type { Attachment } from '@bazilion/api-types'
import type { TranscriptionRoute } from '../core/transcription-config.ts'

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

/** The words in one audio file; throws with the endpoint's own reason. */
export async function transcribe(
  route: Extract<TranscriptionRoute, { ready: true }>,
  file: Attachment,
  options: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
): Promise<string> {
  const form = new FormData()
  const bytes = Buffer.from(file.data, 'base64')
  form.append('file', new Blob([new Uint8Array(bytes)], { type: file.mimeType }), fileName(file))
  form.append('model', route.modelId)
  const response = await (options.fetchImpl ?? fetch)(
    'https://api.openai.com/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${route.apiKey}` },
      body: form,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )
  const body = (await response.json().catch(() => null)) as {
    text?: unknown
    error?: { message?: unknown }
  } | null
  if (!response.ok) {
    const reason = typeof body?.error?.message === 'string' ? body.error.message : ''
    throw new Error(`${response.status}${reason ? `: ${reason}` : ''}`)
  }
  if (typeof body?.text !== 'string') throw new Error('the answer had no text')
  return body.text.trim()
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
