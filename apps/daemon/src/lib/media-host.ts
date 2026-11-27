// The daemon side of the media tools (BAZ-095, BAZ-096): it calls the chosen model with the keys
// it holds, saves what the model made as a result in the turn's conversation, and wakes the Agent
// when something made in the background is ready.

import type { BazilionDb } from '../core/db/client.ts'
import { audioRoute, speechRoute, videoRoute } from '../core/media-routes.ts'
import * as results from '../core/repos/results.ts'
import { transcriptionRoute } from '../core/transcription-config.ts'
import { ContainedFileError } from '../runtime/safe-files.ts'
import { MAX_PICTURE_BYTES, pictureType } from '../runtime/tools/pictures.ts'
import type {
  AudioHost,
  MediaOutput,
  SpeechHost,
  TranscriptionHost,
  VideoHost,
  WorkerHosts,
} from '../runtime/worker/ipc-protocol.ts'
import { checkAudioRequest, generateAudio } from './media/audio.ts'
import { type Fetch, mediaType } from './media/http.ts'
import { synthesize } from './media/speech.ts'
import { checkVideoRequest, generateVideo } from './media/video.ts'
import { timedText, transcribeAudio } from './transcription.ts'
import { queueWake } from './wakes.ts'

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/
const MAX_PROMPT_BYTES = 8192

export interface MediaHostOptions {
  db: BazilionDb
  agentId: string
  teamId: string
  /** The turn's conversation; what is saved is delivered in it. */
  conversationId: string
  signal: AbortSignal
  env: () => NodeJS.ProcessEnv
  /**
   * A file the Agent names, read as its file tools would (container paths in Docker), up to
   * `maxBytes` when given; throws when it is not one the Agent may read.
   */
  readFile: (path: string, maxBytes?: number) => Buffer
  /** Tests replace the network, and the wait between looks at a video job. */
  fetch?: Fetch
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function checkPrompt(prompt: unknown, tool: string): string {
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (!text || Buffer.byteLength(text) > MAX_PROMPT_BYTES)
    throw new Error(`${tool} needs a prompt of at most 8 KiB`)
  return text
}

function checkName(name: unknown): string | undefined {
  if (name === undefined || name === '') return undefined
  if (typeof name !== 'string' || !SAFE_NAME.test(name))
    throw new Error(
      'The name must be a plain file name (letters, digits, space, _ . -; at most 120 characters)',
    )
  return name
}

/** Save one made file as a result of the tool call (at most 25 MiB, like every saved file). */
function save(
  opts: MediaHostOptions,
  made: { bytes: Buffer; mimeType: string; extension: string },
  input: { toolCallId: string; name?: string | undefined },
  model: string,
  stem: string,
): MediaOutput['files'][number] {
  const base = (input.name ?? stem).replace(/\.[a-z0-9]{2,4}$/i, '')
  const saved = results.publish(opts.db, {
    teamId: opts.teamId,
    agentId: opts.agentId,
    sessionId: opts.conversationId,
    toolCallId: input.toolCallId,
    imageModel: model,
    name: `${base}.${made.extension}`,
    mimeType: made.mimeType,
    bytes: made.bytes,
  })
  return { name: saved.name, mimeType: saved.mimeType, result: { resultId: saved.id } }
}

/** Tell the Agent, in the conversation, that what it asked for in the background is there. */
function wakeWith(
  opts: MediaHostOptions,
  id: string,
  what: string,
  outcome: { files: MediaOutput['files'] } | { error: unknown; model: string },
): void {
  if ('files' in outcome) {
    const ids = outcome.files.map((file) => file.result.resultId)
    queueWake({
      id,
      agentId: opts.agentId,
      conversationId: opts.conversationId,
      summary: `The ${what} you asked for is ready`,
      text: [
        `The ${what} is saved: ${outcome.files.map((file) => `"${file.name}" as result ${file.result.resultId}`).join(', ')}.`,
        `Show it to the user with deliver_file and result set to ${ids.join(', then ')}, and say what it is.`,
      ].join('\n\n'),
      at: Date.now(),
    })
    return
  }
  const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
  queueWake({
    id,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    summary: `The ${what} you asked for could not be made`,
    text: `${outcome.model} failed: ${reason}. Tell the user, and try again only if it is worth it.`,
    at: Date.now(),
  })
}

function readPicture(opts: MediaHostOptions, path: string): { bytes: Buffer; mimeType: string } {
  const bytes = opts.readFile(path, MAX_PICTURE_BYTES)
  const type = pictureType(bytes)
  if (!type || type.mimeType === 'image/gif')
    throw new Error(`${path} is not a PNG, JPEG or WebP picture`)
  return { bytes, mimeType: type.mimeType }
}

export function createVideoHost(opts: MediaHostOptions): VideoHost {
  return {
    async generate(input) {
      const prompt = checkPrompt(input.prompt, 'video_generate')
      const name = checkName(input.name)
      const chosen = videoRoute(opts.env())
      if (!chosen.ready) throw new Error(chosen.reason)
      const image = input.image ? readPicture(opts, input.image) : undefined
      const request = {
        prompt,
        seconds: input.seconds,
        shape: input.shape,
        ...(image ? { image } : {}),
      }
      // Checked now, so a length or shape the model does not take is refused while the Agent
      // is still there to choose again.
      checkVideoRequest(chosen.route, request)
      // A video takes minutes: always in the background, past the end of the turn.
      void generateVideo(chosen, request, {
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.pause ? { pause: opts.pause } : {}),
      })
        .then((video) => ({
          files: [
            save(opts, video, { toolCallId: input.toolCallId, name }, chosen.route.model, 'video'),
          ],
        }))
        .then(
          (saved) => wakeWith(opts, `video:${input.toolCallId}`, 'video', saved),
          (error: unknown) =>
            wakeWith(opts, `video:${input.toolCallId}`, 'video', {
              error,
              model: chosen.route.model,
            }),
        )
      return { model: chosen.route.model, files: [], pending: true }
    },
  }
}

export function createAudioHost(opts: MediaHostOptions): AudioHost {
  return {
    async generate(input, signal) {
      const prompt = checkPrompt(input.prompt, 'audio_generate')
      const name = checkName(input.name)
      const chosen = audioRoute(opts.env())
      if (!chosen.ready) throw new Error(chosen.reason)
      const request = {
        kind: input.kind,
        prompt,
        ...(input.lyrics ? { lyrics: input.lyrics } : {}),
        ...(input.instrumental ? { instrumental: true } : {}),
        ...(input.seconds !== undefined ? { seconds: input.seconds } : {}),
        ...(input.loop ? { loop: true } : {}),
      }
      checkAudioRequest(chosen.route, request)
      const what = input.kind === 'sound' ? 'sound' : 'music'
      const make = (callSignal?: AbortSignal) =>
        generateAudio(chosen, request, {
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
          ...(callSignal ? { signal: callSignal } : {}),
        }).then((audio) => ({
          files: [
            save(opts, audio, { toolCallId: input.toolCallId, name }, chosen.route.model, what),
          ],
          ...(audio.words ? { words: audio.words } : {}),
        }))
      if (!input.background) {
        const made = await make(signal ? AbortSignal.any([opts.signal, signal]) : opts.signal)
        return { model: chosen.route.model, ...made }
      }
      // In the background: the turn goes on, and the end of the turn does not stop it.
      void make().then(
        (saved) => wakeWith(opts, `audio:${input.toolCallId}`, what, saved),
        (error: unknown) =>
          wakeWith(opts, `audio:${input.toolCallId}`, what, { error, model: chosen.route.model }),
      )
      return { model: chosen.route.model, files: [], pending: true }
    },
  }
}

export function createSpeechHost(opts: MediaHostOptions): SpeechHost {
  return {
    async speak(input, signal) {
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      if (!text) throw new Error('speak needs text to say')
      const name = checkName(input.name)
      const env = opts.env()
      const chosen = speechRoute(env)
      if (!chosen.ready) throw new Error(chosen.reason)
      const spoken = await synthesize(chosen, text, input.voice ?? env.BAZILION_SPEECH_VOICE, {
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        signal: signal ? AbortSignal.any([opts.signal, signal]) : opts.signal,
      })
      return {
        model: chosen.route.model,
        files: [
          save(opts, spoken, { toolCallId: input.toolCallId, name }, chosen.route.model, 'speech'),
        ],
      }
    },
  }
}

export function createTranscriptionHost(opts: MediaHostOptions): TranscriptionHost {
  return {
    async transcribe(input, signal) {
      const route = transcriptionRoute(opts.env())
      if (!route.ready) throw new Error(route.reason)
      let bytes: Buffer
      try {
        bytes = opts.readFile(input.path, route.maxBytes)
      } catch (error) {
        if (error instanceof ContainedFileError && error.reason === 'too_large')
          throw new Error(
            `${input.path} is larger than the ${Math.round((route.maxBytes ?? 0) / 1_000_000)} MB ${route.label} takes`,
          )
        throw error
      }
      if (route.maxBytes !== undefined && bytes.length > route.maxBytes)
        throw new Error(
          `${input.path} is larger than the ${Math.round(route.maxBytes / 1_000_000)} MB ${route.label} takes`,
        )
      const type = mediaType(bytes)
      if (!type) throw new Error(`${input.path} is not an audio or video file this can read`)
      const transcript = await transcribeAudio(
        route,
        { bytes, mimeType: type.mimeType, name: `audio.${type.extension}` },
        {
          timed: true,
          signal: signal ? AbortSignal.any([opts.signal, signal]) : opts.signal,
          ...(opts.fetch ? { fetchImpl: opts.fetch } : {}),
        },
      )
      return {
        model: route.label,
        text: transcript.text,
        ...(transcript.lines?.length ? { timed: timedText(transcript) } : {}),
      }
    },
  }
}

/** The media hosts a turn gets: each only while its model is chosen and has its key. */
export function mediaHosts(
  opts: MediaHostOptions,
): Pick<WorkerHosts, 'videoHost' | 'audioHost' | 'speechHost' | 'transcriptionHost'> {
  const env = opts.env()
  return {
    ...(videoRoute(env).ready ? { videoHost: createVideoHost(opts) } : {}),
    ...(audioRoute(env).ready ? { audioHost: createAudioHost(opts) } : {}),
    ...(speechRoute(env).ready ? { speechHost: createSpeechHost(opts) } : {}),
    ...(transcriptionRoute(env).ready ? { transcriptionHost: createTranscriptionHost(opts) } : {}),
  }
}
