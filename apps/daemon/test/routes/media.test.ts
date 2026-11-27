// BAZ-095, BAZ-096, BAZ-097: what the web plays, frames and reads out. Sounds and videos are served
// in parts for seeking, a canvas as inert text, and speech and dictation through the chosen models.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let home: string
let oldHome: string | undefined

beforeEach(() => {
  oldHome = process.env.BAZILION_HOME
  home = mkdtempSync(join(tmpdir(), 'bazilion-media-routes-'))
  process.env.BAZILION_HOME = home
  vi.resetModules()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  try {
    ;(await import('../../src/lib/ctx.ts')).getCtx().db.close()
  } catch {}
  if (oldHome === undefined) delete process.env.BAZILION_HOME
  else process.env.BAZILION_HOME = oldHome
  rmSync(home, { recursive: true, force: true })
  vi.resetModules()
})

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([1, 2, 3, 4, 5, 6, 7])])

async function boot() {
  const { createApp } = await import('../../src/app.ts')
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const ctx = getCtx()
  const now = Date.now()
  ctx.db.raw.run(
    "INSERT INTO provider_state (provider_id, enabled, updated_at) VALUES ('lmstudio', 1, ?)",
    [now],
  )
  ctx.db.raw.run(
    "INSERT INTO provider_models (provider, model, added_at) VALUES ('lmstudio', 'qa', ?)",
    [now],
  )
  const app = createApp()
  const headers = { authorization: `Bearer ${ctx.authToken}`, 'content-type': 'application/json' }
  return { app, ctx, headers }
}

async function saveResult(name: string, mimeType: string, bytes: Buffer): Promise<string> {
  const { getCtx } = await import('../../src/lib/ctx.ts')
  const results = await import('../../src/core/repos/results.ts')
  const { db, paths } = getCtx()
  const { teamRepo } = await import('../../src/core/index.ts')
  if (!teamRepo.get(db, 'team', paths)) teamRepo.insert(db, { id: 'team', name: 'Team' }, paths)
  return results.publish(db, {
    teamId: 'team',
    agentId: 'agent',
    sessionId: 'conversation',
    toolCallId: `call-${name.replace(/\W/g, '')}`,
    name,
    mimeType,
    bytes,
  }).id
}

test('a sound plays inline and in parts; a page is only ever text for the frame', async () => {
  const { app, headers } = await boot()
  const sound = await saveResult('song.mp3', 'audio/mpeg', MP3)
  const page = await saveResult('chart.html', 'text/html', Buffer.from('<script>1</script>'))

  const whole = await app.request(`/api/results/${sound}/media`, { headers })
  expect(whole.status).toBe(200)
  expect(whole.headers.get('content-type')).toBe('audio/mpeg')
  expect(whole.headers.get('accept-ranges')).toBe('bytes')
  const part = await app.request(`/api/results/${sound}/media`, {
    headers: { ...headers, range: 'bytes=3-5' },
  })
  expect(part.status).toBe(206)
  expect(part.headers.get('content-range')).toBe(`bytes 3-5/${MP3.length}`)
  expect(Buffer.from(await part.arrayBuffer())).toEqual(MP3.subarray(3, 6))
  const tail = await app.request(`/api/results/${sound}/media`, {
    headers: { ...headers, range: 'bytes=-2' },
  })
  expect(Buffer.from(await tail.arrayBuffer())).toEqual(MP3.subarray(-2))
  const past = await app.request(`/api/results/${sound}/media`, {
    headers: { ...headers, range: 'bytes=500-' },
  })
  expect(past.status).toBe(416)
  // A page is never played, and its text comes inert.
  expect((await app.request(`/api/results/${page}/media`, { headers })).status).toBe(415)
  const canvas = await app.request(`/api/results/${page}/canvas`, { headers })
  expect(canvas.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(canvas.headers.get('content-security-policy')).toContain('sandbox')
  expect(await canvas.text()).toBe('<script>1</script>')
  expect((await app.request(`/api/results/${sound}/canvas`, { headers })).status).toBe(415)
})

test('speech and dictation say when their models are off, and go through them when on', async () => {
  const { app, headers } = await boot()
  const status = async () => (await app.request('/api/speech/status', { headers })).json()
  expect(await status()).toEqual({ speech: false, transcription: false })
  const say = (body: object) =>
    app.request('/api/speech', { method: 'POST', headers, body: JSON.stringify(body) })
  expect((await say({ text: 'Hello' })).status).toBe(409)

  process.env.BAZILION_SPEECH_MODEL = 'xai:tts'
  process.env.BAZILION_TRANSCRIPTION_MODEL = 'xai:grok-voice-transcribe-2.0'
  process.env.XAI_API_KEY = 'xk'
  try {
    expect(await status()).toEqual({ speech: true, transcription: true })
    const sent: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        sent.push({
          url,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        })
        if (url.endsWith('/v1/tts/voices'))
          return Response.json({ voices: [{ voice_id: 'eve', name: 'Eve', language: 'en' }] })
        if (url.endsWith('/v1/tts')) return new Response(new Uint8Array(MP3))
        if (url.endsWith('/v1/stt')) return Response.json({ text: ' Buy milk. ' })
        throw new Error(url)
      }),
    )
    const voices = await app.request('/api/speech/voices', { headers })
    expect(await voices.json()).toEqual({
      model: 'Grok Voice',
      voices: [{ id: 'eve', name: 'Eve', detail: 'en' }],
    })
    // Read aloud reads the prose of a Markdown message, in the voice asked for.
    const spoken = await say({ text: '**Done.**\n```\ncode\n```', markdown: true, voice: 'eve' })
    expect(spoken.headers.get('content-type')).toBe('audio/mpeg')
    expect(sent.at(-1)?.body).toMatchObject({ text: 'Done.', voice_id: 'eve' })
    expect((await say({ text: '```\nonly code\n```', markdown: true })).status).toBe(400)

    const dictated = await app.request('/api/transcription', {
      method: 'POST',
      headers,
      body: JSON.stringify({ mimeType: 'audio/webm;codecs=opus', data: MP3.toString('base64') }),
    })
    expect(await dictated.json()).toEqual({ text: 'Buy milk.', model: 'Grok Voice Transcribe 2.0' })
  } finally {
    delete process.env.BAZILION_SPEECH_MODEL
    delete process.env.BAZILION_TRANSCRIPTION_MODEL
    delete process.env.XAI_API_KEY
  }
})

test('a voice belongs to its speech model: another model forgets it, the same one keeps it', async () => {
  const { app, headers } = await boot()
  const put = (name: string, value: string) =>
    app.request(`/api/config/fields/${name}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ value }),
    })
  const voice = async () =>
    (
      (await (await app.request('/api/config/models', { headers })).json()) as {
        speech: { voice: string | null }
      }
    ).speech.voice
  expect((await put('BAZILION_SPEECH_MODEL', 'xai:tts')).status).toBe(200)
  await put('BAZILION_SPEECH_VOICE', 'eve')
  expect(await voice()).toBe('eve')
  await put('BAZILION_SPEECH_MODEL', 'xai:tts')
  expect(await voice()).toBe('eve')
  await put('BAZILION_SPEECH_MODEL', 'elevenlabs:eleven_v4')
  expect(await voice()).toBeNull()
  // Set together, as `bazilion config set` may: the model first, so the voice stays.
  const both = await app.request('/api/config/fields', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      values: { BAZILION_SPEECH_VOICE: 'v42', BAZILION_SPEECH_MODEL: 'minimax:speech-2.8-hd' },
    }),
  })
  expect(both.status).toBe(200)
  expect(await voice()).toBe('v42')
})
