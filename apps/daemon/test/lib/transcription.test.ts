import { expect, test } from 'vitest'
import { transcriptionRoute } from '../../src/core/transcription-config.ts'
import { transcriptNotes } from '../../src/lib/transcription.ts'

const voice = {
  name: 'voice.ogg',
  mimeType: 'audio/ogg',
  data: Buffer.from('OggS').toString('base64'),
}

test('the route is off until chosen, and needs an OpenAI key', () => {
  expect(transcriptionRoute({})).toEqual({
    ready: false,
    reason: 'Voice notes are not transcribed.',
  })
  expect(transcriptionRoute({ BAZILION_TRANSCRIPTION_MODEL: 'openai:gpt-transcribe' })).toEqual({
    ready: false,
    reason: 'openai:gpt-transcribe needs OPENAI_API_KEY.',
  })
  expect(transcriptionRoute({ BAZILION_TRANSCRIPTION_MODEL: 'other:model' })).toMatchObject({
    ready: false,
  })
  expect(
    transcriptionRoute({
      BAZILION_TRANSCRIPTION_MODEL: 'openai:gpt-transcribe',
      OPENAI_API_KEY: 'sk-test',
    }),
  ).toEqual({
    ready: true,
    model: 'openai:gpt-transcribe',
    label: 'GPT Transcribe',
    provider: 'openai',
    maxBytes: 25_000_000,
    modelId: 'gpt-transcribe',
    apiKey: 'sk-test',
  })
})

test('audio you send comes with its words; one that fails says why', async () => {
  const route = transcriptionRoute({
    BAZILION_TRANSCRIPTION_MODEL: 'openai:gpt-transcribe',
    OPENAI_API_KEY: 'sk-test',
  })
  const sent: Array<{ url: string; auth: string | null; model: unknown; file: string }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const form = init.body as FormData
    const file = form.get('file') as File
    sent.push({
      url,
      auth: new Headers(init.headers).get('authorization'),
      model: form.get('model'),
      file: file.name,
    })
    if (file.name.startsWith('broken'))
      return new Response(JSON.stringify({ error: { message: 'Audio file might be corrupted' } }), {
        status: 400,
      })
    return new Response(JSON.stringify({ text: ' Remind me to call the bank tomorrow. ' }))
  }) as unknown as typeof fetch
  const notes = await transcriptNotes(
    route,
    [
      voice,
      { name: 'report.pdf', mimeType: 'application/pdf', data: '' },
      { name: 'broken', mimeType: 'audio/mpeg', data: '' },
    ],
    { fetchImpl },
  )
  expect(sent).toEqual([
    {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      auth: 'Bearer sk-test',
      model: 'gpt-transcribe',
      file: 'voice.ogg',
    },
    {
      url: 'https://api.openai.com/v1/audio/transcriptions',
      auth: 'Bearer sk-test',
      model: 'gpt-transcribe',
      file: 'broken.mp3',
    },
  ])
  expect(notes).toBe(
    '[voice.ogg, transcribed by GPT Transcribe:]\nRemind me to call the bank tomorrow.\n\n[broken could not be transcribed: 400: Audio file might be corrupted]',
  )
  // Without a route nothing is sent.
  expect(await transcriptNotes(transcriptionRoute({}), [voice], { fetchImpl })).toBe('')
  expect(sent).toHaveLength(2)
})
