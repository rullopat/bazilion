// BAZ-095 and BAZ-096: what each media provider is sent and how its answer is read, against a
// stand-in network that answers as the provider documents it.
import { expect, test } from 'vitest'
import { audioRoute, speechRoute, videoRoute } from '../../src/core/media-routes.ts'
import { transcriptionRoute } from '../../src/core/transcription-config.ts'
import { generateAudio } from '../../src/lib/media/audio.ts'
import { errorReason, mediaType, wavFromPcm } from '../../src/lib/media/http.ts'
import { listVoices, speakableText, synthesize } from '../../src/lib/media/speech.ts'
import { generateVideo } from '../../src/lib/media/video.ts'
import { timedText, transcribeAudio } from '../../src/lib/transcription.ts'

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])

interface Sent {
  url: string
  method: string
  headers: Headers
  body: unknown
}

/** A network that records each request and answers with the next reply for its URL. */
function network(replies: Array<[RegExp, () => Response]>) {
  const sent: Sent[] = []
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    let body: unknown = init.body
    if (typeof body === 'string') body = JSON.parse(body)
    sent.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body })
    const at = replies.findIndex(([pattern]) => pattern.test(url))
    if (at < 0) throw new Error(`unexpected request to ${url}`)
    const [, reply] = replies.splice(at, 1)[0] as [RegExp, () => Response]
    return reply()
  }) as unknown as typeof fetch
  return { sent, fetch: fetchImpl }
}

const json =
  (value: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(value), { status })
const bytes = (value: Buffer) => () => new Response(new Uint8Array(value))
const noWait = async () => {}

function ready<T extends { ready: boolean }>(chosen: T): Extract<T, { ready: true }> {
  if (!chosen.ready) throw new Error('route not ready')
  return chosen as Extract<T, { ready: true }>
}

test('a route is off until chosen and needs its provider key; media models stay out of Chat', () => {
  expect(videoRoute({})).toEqual({ ready: false, reason: 'Video generation is off.' })
  expect(videoRoute({ BAZILION_VIDEO_MODEL: 'xai:grok-imagine-video-1.5' })).toEqual({
    ready: false,
    reason: 'xai:grok-imagine-video-1.5 needs XAI_API_KEY.',
  })
  expect(
    audioRoute({ BAZILION_AUDIO_MODEL: 'elevenlabs:music_v2_5', ELEVENLABS_API_KEY: 'el' }),
  ).toMatchObject({ ready: true, modelId: 'music_v2_5', apiKey: 'el' })
  expect(speechRoute({ BAZILION_SPEECH_MODEL: 'nobody:voice' })).toMatchObject({ ready: false })
})

test('xAI makes a video as a job, asked about until done, then fetched without the key', async () => {
  const net = network([
    [/videos\/generations$/, json({ request_id: 'req-1' })],
    [/videos\/req-1$/, json({ status: 'pending', progress: 40 })],
    [/videos\/req-1$/, json({ status: 'done', video: { url: 'https://vidgen.x.ai/v.mp4' } })],
    [/vidgen\.x\.ai/, bytes(MP4)],
  ])
  const chosen = ready(
    videoRoute({ BAZILION_VIDEO_MODEL: 'xai:grok-imagine-video-1.5', XAI_API_KEY: 'xk' }),
  )
  const video = await generateVideo(
    chosen,
    {
      prompt: 'A cat on a balcony',
      seconds: 6,
      shape: 'portrait',
      image: { bytes: Buffer.from('png'), mimeType: 'image/png' },
    },
    { fetch: net.fetch, pause: noWait },
  )
  expect(video).toMatchObject({ mimeType: 'video/mp4', extension: 'mp4' })
  expect(net.sent[0]?.body).toEqual({
    model: 'grok-imagine-video-1.5',
    prompt: 'A cat on a balcony',
    duration: 6,
    aspect_ratio: '9:16',
    resolution: '720p',
    image: { url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` },
  })
  expect(net.sent[0]?.headers.get('authorization')).toBe('Bearer xk')
  expect(net.sent[3]?.headers.get('authorization')).toBeNull()
  // A length or shape the model does not take is refused before anything is sent.
  await expect(
    generateVideo(chosen, { prompt: 'x', seconds: 30, shape: 'landscape' }, { fetch: net.fetch }),
  ).rejects.toThrow('Grok Imagine Video 1.5 makes videos of 1 to 15 whole seconds')
})

test('Gemini Omni answers with the video; MiniMax runs a job and fails with its reason', async () => {
  const google = network([
    [
      /interactions$/,
      json({
        status: 'completed',
        steps: [
          { type: 'thought', content: [] },
          { type: 'model_output', content: [{ type: 'video', data: MP4.toString('base64') }] },
        ],
      }),
    ],
  ])
  const omni = ready(
    videoRoute({ BAZILION_VIDEO_MODEL: 'google:gemini-omni-1.2-flash', GEMINI_API_KEY: 'gk' }),
  )
  expect(
    await generateVideo(omni, { prompt: 'Rain', seconds: 5, shape: 'landscape' }, google),
  ).toMatchObject({ mimeType: 'video/mp4' })
  expect(google.sent[0]?.headers.get('x-goog-api-key')).toBe('gk')
  expect(google.sent[0]?.body).toMatchObject({
    model: 'gemini-omni-1.2-flash',
    input: 'Rain',
    response_format: { type: 'video', aspect_ratio: '16:9', duration: '5s' },
  })
  await expect(
    generateVideo(omni, { prompt: 'x', seconds: 5, shape: 'square' }, google),
  ).rejects.toThrow('Gemini Omni Flash makes landscape or portrait videos')

  const minimax = network([
    [/v2\/video_generation$/, json({ task_id: 't1' })],
    [/query\/video_generation\/t1$/, json({ task: { status: 'running' } })],
    [
      /query\/video_generation\/t1$/,
      json({ task: { status: 'failed', error: { code: '1026', message: 'sensitive input' } } }),
    ],
  ])
  const h3 = ready(
    videoRoute({ BAZILION_VIDEO_MODEL: 'minimax:MiniMax-H3', MINIMAX_API_KEY: 'mk' }),
  )
  await expect(
    generateVideo(
      h3,
      { prompt: 'x', seconds: 6, shape: 'square' },
      { fetch: minimax.fetch, pause: noWait },
    ),
  ).rejects.toThrow('sensitive input')

  // A provider busy for a moment is asked again; a job ended in a status of its own fails.
  const busy = network([
    [/v2\/video_generation$/, json({ task_id: 't2' })],
    [/query\/video_generation\/t2$/, json({ error: { message: 'overloaded' } }, 503)],
    [
      /query\/video_generation\/t2$/,
      json({ task: { status: 'succeeded', content: { url: 'https://cdn.minimax.io/v.mp4' } } }),
    ],
    [/cdn\.minimax\.io/, bytes(MP4)],
  ])
  expect(
    await generateVideo(
      h3,
      { prompt: 'x', seconds: 6, shape: 'square' },
      { fetch: busy.fetch, pause: noWait },
    ),
  ).toMatchObject({ mimeType: 'video/mp4' })
  const expired = network([
    [/v2\/video_generation$/, json({ task_id: 't3' })],
    [/query\/video_generation\/t3$/, json({ task: { status: 'expired' } })],
  ])
  await expect(
    generateVideo(
      h3,
      { prompt: 'x', seconds: 6, shape: 'square' },
      { fetch: expired.fetch, pause: noWait },
    ),
  ).rejects.toThrow('ended the job: expired')
  expect(minimax.sent[0]?.body).toMatchObject({ duration: 6, ratio: '1:1', resolution: '768P' })
})

test('ElevenLabs makes music and sound effects; Lyria music with its lyrics', async () => {
  const net = network([
    [/v1\/music\?/, bytes(MP3)],
    [/sound-generation\?/, bytes(MP3)],
  ])
  const eleven = ready(
    audioRoute({ BAZILION_AUDIO_MODEL: 'elevenlabs:music_v2_5', ELEVENLABS_API_KEY: 'el' }),
  )
  await generateAudio(
    eleven,
    { kind: 'music', prompt: 'Upbeat jingle', instrumental: true, seconds: 20 },
    net,
  )
  await generateAudio(eleven, { kind: 'sound', prompt: 'A door creaks', seconds: 2 }, net)
  expect(net.sent[0]?.body).toEqual({
    prompt: 'Upbeat jingle',
    model_id: 'music_v2_5',
    force_instrumental: true,
    music_length_ms: 20_000,
  })
  expect(net.sent[1]?.body).toEqual({
    text: 'A door creaks',
    model_id: 'eleven_text_to_sound_v3',
    duration_seconds: 2,
    loop: false,
  })
  expect(net.sent[0]?.headers.get('xi-api-key')).toBe('el')
  await expect(
    generateAudio(eleven, { kind: 'sound', prompt: 'x', seconds: 90 }, net),
  ).rejects.toThrow('makes sound of 0.5 to 30 seconds')

  const google = network([
    [
      /lyria-3\.5:generateContent$/,
      json({
        candidates: [
          {
            content: {
              parts: [
                { text: '[Verse] Hello sun' },
                { inlineData: { data: MP3.toString('base64') } },
              ],
            },
          },
        ],
      }),
    ],
  ])
  const lyria = ready(audioRoute({ BAZILION_AUDIO_MODEL: 'google:lyria-3.5', GEMINI_API_KEY: 'g' }))
  const song = await generateAudio(
    lyria,
    { kind: 'music', prompt: 'A folk song', seconds: 60 },
    google,
  )
  expect(song).toMatchObject({ mimeType: 'audio/mpeg', words: '[Verse] Hello sun' })
  expect(JSON.stringify(google.sent[0]?.body)).toContain('Length: about 60 seconds.')
  await expect(generateAudio(lyria, { kind: 'sound', prompt: 'x' }, google)).rejects.toThrow(
    'Lyria 3.5 makes music, not sound',
  )
})

test('voices come from the provider, every page of them; speech in the chosen voice', async () => {
  const net = network([
    [
      /v2\/voices\?(?!.*next_page_token)/,
      json({
        voices: [{ voice_id: 'v1', name: 'Rachel', category: 'premade' }],
        has_more: true,
        next_page_token: 'p2',
      }),
    ],
    [
      /v2\/voices\?.*next_page_token=p2/,
      json({ voices: [{ voice_id: 'v2', name: 'Adam' }], has_more: false }),
    ],
    [
      /v2\/voices\?(?!.*next_page_token)/,
      json({ voices: [{ voice_id: 'v1', name: 'Rachel' }], has_more: false }),
    ],
    [/text-to-speech\/v1\?output_format=mp3_44100_128$/, bytes(MP3)],
  ])
  const eleven = ready(
    speechRoute({ BAZILION_SPEECH_MODEL: 'elevenlabs:eleven_v4', ELEVENLABS_API_KEY: 'el' }),
  )
  expect(await listVoices(eleven, net)).toEqual([
    { id: 'v1', name: 'Rachel', detail: 'premade' },
    { id: 'v2', name: 'Adam' },
  ])
  // Without a voice chosen, the provider's first one.
  expect(await synthesize(eleven, 'Hello there', undefined, net)).toMatchObject({
    mimeType: 'audio/mpeg',
  })
  expect(net.sent.at(-1)?.body).toEqual({ text: 'Hello there', model_id: 'eleven_v4' })

  // Gemini's samples without a header get one; MiniMax answers in hex with a status of its own.
  const pcm = Buffer.alloc(480)
  const google = network([
    [
      /gemini-3\.8-flash-tts:generateContent$/,
      json({
        candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64') } }] } }],
      }),
    ],
  ])
  const gemini = ready(
    speechRoute({ BAZILION_SPEECH_MODEL: 'google:gemini-3.8-flash-tts', GEMINI_API_KEY: 'g' }),
  )
  const spoken = await synthesize(gemini, 'Hi', 'Kore', google)
  expect(spoken).toMatchObject({ mimeType: 'audio/wav' })
  expect(spoken.bytes.length).toBe(pcm.length + 44)
  // Samples that start like an MP3 frame (silence: FF FF) are still samples: the type decides.
  const silence = Buffer.alloc(480, 0xff)
  const typed = network([
    [
      /gemini-3\.8-flash-tts:generateContent$/,
      json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;codec=pcm;rate=16000',
                    data: silence.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    ],
  ])
  const quiet = await synthesize(gemini, 'Hi', 'Kore', typed)
  expect(quiet.mimeType).toBe('audio/wav')
  expect(quiet.bytes.readUInt32LE(24)).toBe(16_000)
  expect(google.sent[0]?.body).toMatchObject({
    generationConfig: { speechConfig: { voiceConfig: { voice: 'Kore' } } },
  })

  const minimax = network([
    [
      /t2a_v2$/,
      json({ data: null, base_resp: { status_code: 2054, status_msg: 'voice id not exist' } }),
    ],
  ])
  const mm = ready(
    speechRoute({ BAZILION_SPEECH_MODEL: 'minimax:speech-2.8-hd', MINIMAX_API_KEY: 'm' }),
  )
  await expect(synthesize(mm, 'Hi', 'nobody', minimax)).rejects.toThrow('voice id not exist')
})

test('transcripts come with their lines and times where the model gives them', async () => {
  const audio = { bytes: MP3, mimeType: 'audio/mpeg', name: 'meeting.mp3' }
  const xai = network([
    [
      /v1\/stt$/,
      json({
        text: 'Hello team. Next point.',
        words: [
          { text: 'Hello', start: 0.2, end: 0.5 },
          { text: 'team.', start: 0.6, end: 0.9 },
          { text: 'Next', start: 63, end: 63.3 },
          { text: 'point.', start: 63.4, end: 63.8 },
        ],
      }),
    ],
  ])
  const grok = ready(
    transcriptionRoute({
      BAZILION_TRANSCRIPTION_MODEL: 'xai:grok-voice-transcribe-2.0',
      XAI_API_KEY: 'xk',
    }),
  )
  const heard = await transcribeAudio(grok, audio, { fetchImpl: xai.fetch, timed: true })
  expect(timedText(heard)).toBe('[0:00] Hello team.\n[1:03] Next point.')
  // xAI reads the file last.
  const form = xai.sent[0]?.body as FormData
  expect([...form.keys()].at(-1)).toBe('file')

  const groq = network([
    [
      /groq\.com\/openai\/v1\/audio\/transcriptions$/,
      json({ text: 'Hi', segments: [{ start: 3725, text: ' Hi' }] }),
    ],
  ])
  const whisper = ready(
    transcriptionRoute({
      BAZILION_TRANSCRIPTION_MODEL: 'groq:whisper-large-v3-turbo',
      GROQ_API_KEY: 'gq',
    }),
  )
  expect(
    timedText(await transcribeAudio(whisper, audio, { fetchImpl: groq.fetch, timed: true })),
  ).toBe('[1:02:05] Hi')
  expect((groq.sent[0]?.body as FormData).get('response_format')).toBe('verbose_json')

  const failing = network([
    [
      /elevenlabs\.io\/v1\/speech-to-text$/,
      json({ detail: { code: 'invalid_api_key', message: 'Invalid API key' } }, 401),
    ],
  ])
  const scribe = ready(
    transcriptionRoute({
      BAZILION_TRANSCRIPTION_MODEL: 'elevenlabs:scribe_v3',
      ELEVENLABS_API_KEY: 'x',
    }),
  )
  await expect(transcribeAudio(scribe, audio, { fetchImpl: failing.fetch })).rejects.toThrow(
    '401: Invalid API key',
  )
})

test('only the prose of a message is read out', () => {
  expect(
    speakableText(
      [
        '# Plan',
        'Here is **the plan** with [a link](https://x.y) and `code`.',
        '```ts',
        'const secret = 1',
        '```',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
        '- First step',
      ].join('\n'),
    ),
  ).toBe('Plan\nHere is the plan with a link and code.\nFirst step')
})

test('files are told apart by their first bytes; error bodies give their reason', () => {
  expect(mediaType(MP4)?.mimeType).toBe('video/mp4')
  expect(mediaType(MP3)?.mimeType).toBe('audio/mpeg')
  expect(mediaType(wavFromPcm(Buffer.alloc(4), 24_000, 1))?.mimeType).toBe('audio/wav')
  expect(mediaType(Buffer.from('OggS....'))?.mimeType).toBe('audio/ogg')
  expect(mediaType(Buffer.from('<html>'))).toBeNull()
  expect(errorReason({ error: { message: 'bad' } })).toBe('bad')
  expect(errorReason({ detail: [{ msg: 'one' }, { msg: 'two' }] })).toBe('one; two')
  expect(errorReason({ base_resp: { status_code: 1004, status_msg: 'auth' } })).toBe('auth')
})
