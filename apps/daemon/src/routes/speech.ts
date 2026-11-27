// Speech and dictation for the clients (BAZ-096): the chosen speech model's voices, text read out
// (Read aloud in the web chat, a voice sample, `bazilion speech say`), and a recording turned into
// words (dictation in the web chat). The keys stay in the daemon.

import type {
  SpeakRequest,
  SpeechStatusResponse,
  SpeechVoicesResponse,
  TranscribeRequest,
  TranscribeResponse,
} from '@bazilion/api-types'
import { mergeSecretsIntoEnv } from '../core/index.ts'
import { speechRoute } from '../core/media-routes.ts'
import { transcriptionRoute } from '../core/transcription-config.ts'
import { getCtx } from '../lib/ctx.ts'
import { mediaType } from '../lib/media/http.ts'
import { listVoices, speakableText, synthesize } from '../lib/media/speech.ts'
import { transcribeAudio } from '../lib/transcription.ts'
import { jsonBody, newRouter } from './http.ts'

/** Settings in effect: process env over secrets over config, as for a turn. */
function settings(): NodeJS.ProcessEnv {
  const { db, authToken } = getCtx()
  return mergeSecretsIntoEnv(db, authToken)
}

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const speechRouter = newRouter()

// Whether the web offers Read aloud and dictation: a speech model and a transcription model chosen
// and ready.
speechRouter.get('/status', (c) => {
  const env = settings()
  return c.json({
    speech: speechRoute(env).ready,
    transcription: transcriptionRoute(env).ready,
  } satisfies SpeechStatusResponse)
})

speechRouter.get('/voices', async (c) => {
  const chosen = speechRoute(settings())
  if (!chosen.ready) return c.json({ error: chosen.reason }, 409)
  try {
    const voices = await listVoices(chosen, { signal: c.req.raw.signal })
    return c.json({ model: chosen.route.model, voices } satisfies SpeechVoicesResponse)
  } catch (error) {
    return c.json({ error: failure(error) }, 502)
  }
})

speechRouter.post('/', async (c) => {
  const body = await jsonBody<SpeakRequest>(c)
  const raw = typeof body?.text === 'string' ? body.text : ''
  const text = body?.markdown ? speakableText(raw) : raw.trim()
  if (!text) return c.json({ error: 'There is nothing to read out' }, 400)
  const env = settings()
  const chosen = speechRoute(env)
  if (!chosen.ready) return c.json({ error: chosen.reason }, 409)
  const voice =
    typeof body?.voice === 'string' && body.voice.trim() ? body.voice : env.BAZILION_SPEECH_VOICE
  try {
    const spoken = await synthesize(chosen, text, voice, { signal: c.req.raw.signal })
    c.header('Content-Type', spoken.mimeType)
    c.header('Content-Length', String(spoken.bytes.byteLength))
    c.header('Content-Security-Policy', "default-src 'none'; sandbox")
    return c.body(new Uint8Array(spoken.bytes))
  } catch (error) {
    return c.json({ error: failure(error) }, 502)
  }
})

export const transcriptionRouter = newRouter()

transcriptionRouter.post('/', async (c) => {
  const body = await jsonBody<TranscribeRequest>(c)
  if (typeof body?.data !== 'string' || !body.data)
    return c.json({ error: 'data (the recording, base64) is required' }, 400)
  const route = transcriptionRoute(settings())
  if (!route.ready) return c.json({ error: route.reason }, 409)
  const bytes = Buffer.from(body.data, 'base64')
  if (route.maxBytes !== undefined && bytes.length > route.maxBytes)
    return c.json({ error: `The recording is larger than ${route.label} takes` }, 413)
  // The browser's recorder says what it made; the bytes say it when it does not.
  const sniffed = mediaType(bytes)
  const given = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0]?.trim() : ''
  const mimeType =
    given?.startsWith('audio/') || given?.startsWith('video/') ? given : sniffed?.mimeType
  if (!mimeType) return c.json({ error: 'The recording is not audio' }, 415)
  const extension =
    sniffed?.extension ?? (mimeType.includes('webm') ? 'webm' : mimeType.split('/')[1])
  try {
    const transcript = await transcribeAudio(
      route,
      { bytes, mimeType, name: `dictation.${extension}` },
      { signal: c.req.raw.signal },
    )
    return c.json({ text: transcript.text, model: route.label } satisfies TranscribeResponse)
  } catch (error) {
    return c.json({ error: failure(error) }, 502)
  }
})
