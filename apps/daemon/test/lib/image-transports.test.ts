import { expect, test, vi } from 'vitest'
import { imageGenerationConfig, imageTurnEnv } from '../../src/core/image-generation-config.ts'
import {
  boundedImageFetch,
  generateOpenAIImages,
  IMAGE_RESPONSE_BYTES,
} from '../../src/lib/image-transport.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII='
const item = { id: 'ig_1', type: 'image_generation_call', status: 'completed', result: png }
const complete = {
  type: 'response.completed',
  response: {
    id: 'resp_1',
    status: 'completed',
    output: [item],
    usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 },
  },
}
function stream(events: unknown[], newline = '\n') {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join('') +
      `data: [DONE]${newline}${newline}`,
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
function request(provider: 'openai' | 'openai-codex', fetcher: typeof fetch) {
  return generateOpenAIImages({
    provider,
    apiKey: 'private-token',
    prompt: 'A bird',
    signal: new AbortController().signal,
    fetch: fetcher,
  })
}

test('automatic image selection follows enabled text providers, not stored credentials or failures', () => {
  const env = {
    BAZILION_IMAGE_GENERATION: 'on',
    OPENAI_API_KEY: 'direct',
    OPENROUTER_API_KEY: 'router',
  }
  const text = (enabled: string[], chatModel?: string) => ({
    enabledProviders: new Set(enabled),
    chatModel,
  })
  expect(imageGenerationConfig(env, true, text([])).ready).toBe(false)
  expect(imageGenerationConfig(env, true, text(['openrouter'])).ready).toBe(false)
  expect(imageGenerationConfig(env, true, text(['openai']))).toMatchObject({
    ready: true,
    provider: 'openai',
    model: 'openai:gpt-image-2',
  })
  expect(
    imageGenerationConfig({ ...env, BAZILION_IMAGE_MODEL: 'auto' }, true, text(['openai-codex'])),
  ).toMatchObject({ ready: true, provider: 'openai-codex', model: 'openai-codex:gpt-image-2' })
  const both = ['openai', 'openai-codex']
  expect(imageGenerationConfig(env, true, text(both, 'openai:chat')).ready).toBe(true)
  expect(imageGenerationConfig(env, true, text(both, 'openai:chat'))).toMatchObject({
    provider: 'openai',
  })
  expect(imageGenerationConfig(env, true, text(both, 'openai-codex:chat'))).toMatchObject({
    provider: 'openai-codex',
  })
  expect(imageGenerationConfig(env, true, text(both, 'anthropic:chat')).ready).toBe(false)
  expect(imageGenerationConfig(env, true, text(both)).ready).toBe(false)
  expect(imageGenerationConfig(env, true, text(['openai-codex'], 'openai:chat')).ready).toBe(false)
  expect(
    imageGenerationConfig({ ...env, OPENAI_API_KEY: '' }, true, text(both, 'openai:chat')).ready,
  ).toBe(false)
  expect(imageGenerationConfig(env, false, text(both, 'openai-codex:chat')).ready).toBe(false)
  expect(
    imageGenerationConfig({ ...env, BAZILION_IMAGE_GENERATION: 'off' }, true, text(['openai']))
      .ready,
  ).toBe(false)
  expect(
    imageGenerationConfig({ ...env, BAZILION_IMAGE_MODEL: 'openai/gpt-image-2' }, true, text(both)),
  ).toMatchObject({ ready: true, provider: 'openrouter' })
})

test('direct image routes select credentials explicitly with no API-key or subscription fallback', () => {
  const env = {
    BAZILION_IMAGE_GENERATION: 'on',
    BAZILION_IMAGE_MODEL: 'openai:gpt-image-2',
    OPENAI_API_KEY: 'direct',
    OPENROUTER_API_KEY: 'router',
  }
  expect(imageGenerationConfig(env, true)).toMatchObject({
    ready: true,
    provider: 'openai',
    apiKey: 'direct',
  })
  expect(imageGenerationConfig({ ...env, OPENAI_API_KEY: '' }, true).ready).toBe(false)
  expect(
    imageGenerationConfig({ ...env, BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' }).ready,
  ).toBe(false)
  const codex = imageGenerationConfig(
    { ...env, BAZILION_IMAGE_MODEL: 'openai-codex:gpt-image-2' },
    true,
  )
  expect(codex).toMatchObject({ ready: true, provider: 'openai-codex' })
  expect(codex).not.toHaveProperty('apiKey')
  expect(imageTurnEnv(env, 'lmstudio:chat')).not.toHaveProperty('OPENAI_API_KEY')
  expect(imageTurnEnv(env, 'lmstudio:chat')).not.toHaveProperty('OPENROUTER_API_KEY')
  expect(imageTurnEnv(env, 'openai:chat').OPENAI_API_KEY).toBe('direct')
  expect(env.OPENAI_API_KEY).toBe('direct')
})

test.each([
  'openai',
  'openai-codex',
] as const)('fixed %s image transport sends only the selected credential and captures PNG/usage', async (provider) => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe(
      provider === 'openai'
        ? 'https://api.openai.com/v1/images/generations'
        : 'https://chatgpt.com/backend-api/codex/responses',
    )
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token')
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(String(init?.body))
    if (provider === 'openai') {
      expect(body).toEqual({
        model: 'gpt-image-2',
        prompt: 'A bird',
        n: 1,
        size: '1024x1024',
        output_format: 'png',
      })
      return Response.json({
        data: [{ b64_json: png }],
        usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 },
      })
    }
    expect(body.model).toBe('gpt-6-astra')
    expect(body.tools).toEqual([
      { type: 'image_generation', model: 'gpt-image-2', size: '1024x1024', output_format: 'png' },
    ])
    expect(body.tool_choice).toEqual({ type: 'image_generation' })
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'A bird' }] },
    ])
    return stream([{ type: 'response.output_item.done', item }, complete], '\r\n')
  })
  const result = await request(provider, fetcher)
  expect(result.output).toEqual([{ type: 'image', mimeType: 'image/png', data: png }])
  expect(result.usage).toEqual({ input: 4, output: 5, totalTokens: 9 })
  expect(result.usage?.cost).toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([
  'openai',
  'openai-codex',
] as const)('failed %s image request never retries or switches credential routes', async (provider) => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: { message: 'private-token' } }, { status: 401 }),
  )
  await expect(request(provider, fetcher)).rejects.toThrow('rejected')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([
  ['truncated', [{ type: 'response.output_item.done', item }]],
  ['failed', [{ type: 'response.failed', response: { error: { message: 'private-token' } } }]],
  ['incomplete', [{ type: 'response.incomplete' }]],
  [
    'empty final overrides earlier image',
    [
      { type: 'response.output_item.done', item },
      { type: 'response.completed', response: { output: [] } },
    ],
  ],
  [
    'failed image',
    [{ type: 'response.completed', response: { output: [{ ...item, status: 'failed' }] } }],
  ],
  ['duplicate image', [{ type: 'response.completed', response: { output: [item, item] } }]],
  ['duplicate completion', [complete, complete]],
  ['late failure', [complete, { type: 'error' }]],
  [
    'too many events',
    [...Array.from({ length: 512 }, () => ({ type: 'response.created' })), complete],
  ],
  [
    'URL instead of bytes',
    [
      {
        type: 'response.completed',
        response: {
          output: [{ ...item, result: undefined, url: 'https://private.invalid/image' }],
        },
      },
    ],
  ],
])('Codex image stream fails closed on %s', async (_, events) => {
  const fetcher = vi.fn<typeof fetch>(async () => stream(events))
  await expect(request('openai-codex', fetcher)).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('Codex accepts terminal image output with optional item metadata omitted', async () => {
  const result = await request('openai-codex', async () =>
    stream([
      {
        type: 'response.completed',
        response: { output: [{ type: 'image_generation_call', result: png }] },
      },
    ]),
  )
  expect(result.output).toHaveLength(1)
})

test('Codex rejects malformed event JSON rather than treating a partial stream as success', async () => {
  await expect(
    request(
      'openai-codex',
      async () =>
        new Response('data: {broken}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    ),
  ).rejects.toThrow()
})

test('Codex recovers a completed image event only when final output is omitted', async () => {
  const result = await request('openai-codex', async () =>
    stream([
      { type: 'response.output_item.done', item },
      { type: 'response.completed', response: { id: 'resp', status: 'completed' } },
    ]),
  )
  expect(result.output).toHaveLength(1)
})

test.each([
  'openai',
  'openai-codex',
] as const)('%s image transport rejects credential destination changes and oversized raw bodies', async (provider) => {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response('{}', { headers: { 'content-length': String(IMAGE_RESPONSE_BYTES + 1) } }),
  )
  await expect(boundedImageFetch(fetcher, provider)('https://attacker.invalid')).rejects.toThrow(
    'endpoint',
  )
  expect(fetcher).not.toHaveBeenCalled()
  await expect(request(provider, fetcher)).rejects.toThrow('byte limit')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('direct OpenAI never downloads provider-returned URLs', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [{ url: 'http://127.0.0.1/private' }] }),
  )
  await expect(request('openai', fetcher)).rejects.toThrow('image bytes')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
