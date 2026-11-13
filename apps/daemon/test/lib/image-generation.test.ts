import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { imageRoute } from '../../src/core/image-generation-config.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as results from '../../src/core/repos/results.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import { createImageGenerationHost } from '../../src/lib/image-generation.ts'
import { ourToolToPiTool } from '../../src/runtime/pi/tools.ts'
import { imageGenerateTool } from '../../src/runtime/tools/image-generate.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
  'base64',
)
const b64 = png.toString('base64')
let env: TestEnv
let agentId: string
let conversationId: string
let config: NodeJS.ProcessEnv
let turn: AbortController
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'producer', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
  conversationId = resolveConversationTarget(env.db, env.paths, agentId).id
  config = { BAZILION_IMAGE_MODEL: 'openai:gpt-image-2', OPENAI_API_KEY: 'sk-test' }
  turn = new AbortController()
  fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: b64 }] }))
})
afterEach(() => env.cleanup())

function host() {
  return createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    conversationId,
    signal: turn.signal,
    env: () => config,
    codex: { connected: () => true, accessToken: async () => 'codex-token' },
    fetch: fetcher,
  })
}
function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('the selected route is one setting: off, or a model whose account is ready', () => {
  expect(imageRoute({}, true)).toMatchObject({ ready: false, reason: 'Image generation is off.' })
  expect(imageRoute({ BAZILION_IMAGE_MODEL: 'dall-e' }, true).ready).toBe(false)
  expect(imageRoute({ BAZILION_IMAGE_MODEL: 'openai:gpt-image-2' }, true)).toMatchObject({
    ready: false,
    reason: expect.stringContaining('OPENAI_API_KEY'),
  })
  expect(imageRoute({ BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' }, false).ready).toBe(false)
  expect(imageRoute({ BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' }, true)).toMatchObject({
    ready: true,
    provider: 'openai-codex',
    modelId: 'gpt-image-2',
  })
  expect(
    imageRoute(
      { BAZILION_IMAGE_MODEL: 'openrouter:openai/gpt-image-2', OPENROUTER_API_KEY: 'k' },
      false,
    ),
  ).toMatchObject({ ready: true, provider: 'openrouter', modelId: 'openai/gpt-image-2' })
})

test('an OpenAI image is saved as a result of the turn; the tool returns references, not bytes', async () => {
  const tool = ourToolToPiTool(imageGenerateTool(host()))
  const output = await tool.execute(
    'call-1',
    { prompt: 'A little bird', name: 'bird' },
    undefined,
    undefined,
    {} as Parameters<typeof tool.execute>[4],
  )
  const [url, init] = fetcher.mock.calls[0] ?? []
  expect(url).toBe('https://api.openai.com/v1/images/generations')
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-test')
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: 'gpt-image-2',
    prompt: 'A little bird',
  })
  const saved = results.list(env.db).results
  expect(saved).toMatchObject([
    {
      name: 'bird.png',
      mimeType: 'image/png',
      imageModel: 'openai:gpt-image-2',
      sessionId: conversationId,
      toolCallId: 'call-1',
    },
  ])
  expect(results.read(env.db, saved[0]?.id ?? '')).toEqual(png)
  expect(output.details).toEqual({ results: [{ resultId: saved[0]?.id }] })
  expect(JSON.stringify(output)).not.toContain(b64)
})

test('the ChatGPT route reads the image from the stream when the completed output is empty', async () => {
  config = { BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' }
  const image = { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: b64 }
  fetcher.mockResolvedValueOnce(
    sse([
      { type: 'response.output_item.done', output_index: 0, item: image },
      { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [] } },
    ]),
  )
  fetcher.mockResolvedValueOnce(
    sse([{ type: 'response.completed', response: { id: 'r2', output: [image] } }]),
  )
  const generator = host()
  for (const call of ['call-1', 'call-2'])
    expect(await generator.generate({ toolCallId: call, prompt: 'A bird' })).toMatchObject({
      model: 'openai-codex:gpt-image-2',
      files: [{ name: 'generated-image.png', mimeType: 'image/png' }],
    })
  const [url, init] = fetcher.mock.calls[0] ?? []
  expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer codex-token')
  expect(JSON.parse(String(init?.body))).toMatchObject({
    stream: true,
    store: false,
    tools: [{ type: 'image_generation', model: 'gpt-image-2' }],
  })
  expect(results.list(env.db).total).toBe(2)
})

test('the OpenRouter route goes through Pi and saves each returned image', async () => {
  config = { BAZILION_IMAGE_MODEL: 'openrouter:openai/gpt-image-2', OPENROUTER_API_KEY: 'or-key' }
  fetcher.mockImplementation(async () =>
    Response.json({
      id: 'gen-1',
      choices: [
        {
          message: {
            images: [
              { image_url: { url: `data:image/png;base64,${b64}` } },
              { image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        },
      ],
    }),
  )
  const output = await host().generate({ toolCallId: 'call-1', prompt: 'Two birds', name: 'birds' })
  expect(output.files.map((file) => file.name)).toEqual(['birds-1.png', 'birds-2.png'])
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://openrouter.ai/api/v1/chat/completions')
  expect(
    results
      .list(env.db)
      .results.map((result) => result.sourceIndex)
      .sort(),
  ).toEqual([0, 1])
})

test('an OpenRouter response is read up to 40 MiB', async () => {
  config = { BAZILION_IMAGE_MODEL: 'openrouter:openai/gpt-image-2', OPENROUTER_API_KEY: 'or-key' }
  // An endless body: reading stops shortly after 40 MiB.
  const chunk = new Uint8Array(1024 * 1024)
  let sent = 0
  fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            sent++
            controller.enqueue(chunk)
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  )
  await expect(host().generate({ toolCallId: 'call-1', prompt: 'A bird' })).rejects.toThrow(
    'larger than 40 MiB',
  )
  expect(sent).toBeLessThan(50)
  expect(results.list(env.db).total).toBe(0)
})

test('the images of one call are saved together or not at all', async () => {
  const large = Buffer.alloc(25 * 1024 * 1024 + 1)
  png.copy(large)
  fetcher.mockResolvedValueOnce(
    Response.json({ data: [{ b64_json: b64 }, { b64_json: large.toString('base64') }] }),
  )
  await expect(host().generate({ toolCallId: 'call-1', prompt: 'Two birds' })).rejects.toThrow(
    '25 MiB',
  )
  expect(results.list(env.db).total).toBe(0)
})

test('the provider’s own error is shown; nothing is saved', async () => {
  fetcher.mockResolvedValueOnce(
    new Response('{"error":{"message":"Your request was rejected by the safety system."}}', {
      status: 400,
    }),
  )
  await expect(host().generate({ toolCallId: 'call-1', prompt: 'x' })).rejects.toThrow(
    /HTTP 400: .*rejected by the safety system/,
  )
  config = { BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' }
  fetcher.mockResolvedValueOnce(
    sse([{ type: 'response.failed', response: { error: { message: 'Image quota exhausted' } } }]),
  )
  await expect(host().generate({ toolCallId: 'call-2', prompt: 'x' })).rejects.toThrow(
    'Image quota exhausted',
  )
  fetcher.mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'bm90IGFuIGltYWdl' }] }))
  config = { BAZILION_IMAGE_MODEL: 'openai:gpt-image-2', OPENAI_API_KEY: 'sk-test' }
  await expect(host().generate({ toolCallId: 'call-3', prompt: 'x' })).rejects.toThrow(
    'not a PNG, JPEG or WebP',
  )
  expect(results.list(env.db).total).toBe(0)
})

test('a turn makes at most four calls; bad input is refused before any request', async () => {
  const generator = host()
  await expect(generator.generate({ toolCallId: 'c', prompt: '  ' })).rejects.toThrow('prompt')
  await expect(
    generator.generate({ toolCallId: 'c', prompt: 'ok', name: '../escape' }),
  ).rejects.toThrow('file name')
  for (const call of ['c1', 'c2', 'c3', 'c4'])
    await generator.generate({ toolCallId: call, prompt: 'A bird' })
  await expect(generator.generate({ toolCallId: 'c5', prompt: 'A bird' })).rejects.toThrow('four')
  expect(fetcher).toHaveBeenCalledTimes(4)
  // A new turn has its own allowance.
  await host().generate({ toolCallId: 'c6', prompt: 'A bird' })
  expect(results.list(env.db).total).toBe(5)
})

test('stopping the turn aborts the request', async () => {
  fetcher.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
  )
  const pending = host().generate({ toolCallId: 'call-1', prompt: 'A bird' })
  turn.abort()
  await expect(pending).rejects.toThrow()
  expect(results.list(env.db).total).toBe(0)
})
