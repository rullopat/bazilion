// BAZ-095 and BAZ-096: the daemon side of the media tools saves what the model made in the turn's
// conversation, wakes the Agent for a video made in the background, and reads the Agent's files
// only up to what the transcription model takes.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as results from '../../src/core/repos/results.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import {
  createAudioHost,
  createSpeechHost,
  createTranscriptionHost,
  createVideoHost,
  mediaHosts,
} from '../../src/lib/media-host.ts'
import { _resetWakesForTest, takeWakes } from '../../src/lib/wakes.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)])
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])

let env: TestEnv
let agentId: string
let conversationId: string
let config: NodeJS.ProcessEnv
let files: Record<string, Buffer>
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  env = makeTestEnv()
  _resetWakesForTest()
  createProfile(env.db, env.paths, { id: 'maker', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'maker', teamId: env.teamId }).id
  conversationId = resolveConversationTarget(env.db, env.paths, agentId).id
  config = {}
  files = {}
  fetcher = vi.fn<typeof fetch>()
})
afterEach(() => env.cleanup())

function options() {
  return {
    db: env.db,
    agentId,
    teamId: env.teamId,
    conversationId,
    signal: new AbortController().signal,
    env: () => config,
    readFile: (path: string, maxBytes?: number) => {
      const bytes = files[path]
      if (!bytes) throw new Error(`${path} is not in your workspace or uploads`)
      if (maxBytes !== undefined && bytes.length > maxBytes) throw new Error('too large')
      return bytes
    },
    fetch: fetcher,
    pause: async () => {},
  }
}

test('a turn gets only the media tools whose models are chosen and ready', () => {
  expect(Object.keys(mediaHosts(options()))).toEqual([])
  config = {
    BAZILION_VIDEO_MODEL: 'xai:grok-imagine-video-1.5',
    BAZILION_SPEECH_MODEL: 'xai:tts',
    BAZILION_AUDIO_MODEL: 'elevenlabs:music_v2_5',
    XAI_API_KEY: 'xk',
  }
  expect(Object.keys(mediaHosts(options()))).toEqual(['videoHost', 'speechHost'])
})

test('a video answers at once, is saved and wakes the Agent', async () => {
  config = { BAZILION_VIDEO_MODEL: 'xai:grok-imagine-video-1.5', XAI_API_KEY: 'xk' }
  const big = Buffer.concat([MP4, Buffer.alloc(4 * 1024 * 1024)])
  fetcher
    .mockResolvedValueOnce(Response.json({ request_id: 'r1' }))
    .mockResolvedValueOnce(
      Response.json({ status: 'done', video: { url: 'https://vidgen.x.ai/a' } }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(big)))
  const output = await createVideoHost(options()).generate({
    toolCallId: 'call_video',
    prompt: 'Waves at dawn',
    seconds: 8,
    shape: 'landscape',
    name: 'dawn',
  })
  expect(output).toEqual({ model: 'Grok Imagine Video 1.5', files: [], pending: true })
  let woke: ReturnType<typeof takeWakes> = []
  await vi.waitFor(
    () => {
      woke = takeWakes(agentId)
      expect(woke).toHaveLength(1)
    },
    { timeout: 2_000 },
  )
  expect(woke[0]?.text).toMatch(/^The video is saved: "dawn.mp4" as result /)
  const [saved] = results.list(env.db, { teamId: env.teamId }).results
  expect(saved).toMatchObject({
    name: 'dawn.mp4',
    mimeType: 'video/mp4',
    imageModel: 'Grok Imagine Video 1.5',
    byteLength: big.length,
  })
  // A length the model does not take is refused while the Agent can still choose again.
  await expect(
    createVideoHost(options()).generate({
      toolCallId: 'call_long',
      prompt: 'x',
      seconds: 60,
      shape: 'landscape',
    }),
  ).rejects.toThrow('1 to 15 whole seconds')
})

test('music is saved and shown at once; speech in the voice chosen under Setup', async () => {
  config = {
    BAZILION_AUDIO_MODEL: 'elevenlabs:music_v2_5',
    BAZILION_SPEECH_MODEL: 'elevenlabs:eleven_v4',
    BAZILION_SPEECH_VOICE: 'voice-42',
    ELEVENLABS_API_KEY: 'el',
  }
  fetcher.mockImplementation(async () => new Response(new Uint8Array(MP3)))
  const music = await createAudioHost(options()).generate({
    toolCallId: 'call_music',
    kind: 'music',
    prompt: 'A calm piano loop',
  })
  expect(music.files.map((file) => file.name)).toEqual(['music.mp3'])
  const speech = await createSpeechHost(options()).speak({
    toolCallId: 'call_speech',
    text: 'Good morning',
  })
  expect(speech.files[0]).toMatchObject({ name: 'speech.mp3', mimeType: 'audio/mpeg' })
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('/v1/text-to-speech/voice-42?')
})

test('a recording is transcribed with its times, up to what the model takes', async () => {
  config = { BAZILION_TRANSCRIPTION_MODEL: 'groq:whisper-large-v3-turbo', GROQ_API_KEY: 'gq' }
  files['talk.mp3'] = MP3
  files['huge.mp3'] = Buffer.concat([MP3, Buffer.alloc(26_000_000)])
  files['notes.txt'] = Buffer.from('plain text')
  fetcher.mockResolvedValue(
    Response.json({ text: 'Hello.', segments: [{ start: 12, text: ' Hello.' }] }),
  )
  const host = createTranscriptionHost(options())
  expect(await host.transcribe({ path: 'talk.mp3' })).toEqual({
    model: 'Whisper Large v3 Turbo',
    text: 'Hello.',
    timed: '[0:12] Hello.',
  })
  await expect(host.transcribe({ path: 'huge.mp3' })).rejects.toThrow('too large')
  await expect(host.transcribe({ path: 'notes.txt' })).rejects.toThrow('not an audio or video')
})
