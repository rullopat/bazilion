import { afterEach, expect, test } from 'vitest'
import {
  isProviderConfigured,
  parseModelString,
  providerModelsUrl,
} from '../../src/core/providers.ts'
import { createPiModel, testProviderModel } from '../../src/runtime/providers/pi-runtime.ts'
import { type MockServer, startMockServer } from './mock-server.ts'

// Model resolution must fail closed: a model id missing from the catalog, built without an
// endpoint, would go to some default endpoint while carrying this provider's credential.

let mock: MockServer | undefined

afterEach(async () => {
  await mock?.stop()
  mock = undefined
})

test('Azure credentials and catalog use Pi naming', async () => {
  for (const [modelId, api] of [
    ['gpt-6.1-sol', 'azure-openai-responses'],
    ['deepseek-v4-pro', 'openai-completions'],
  ] as const) {
    const { runtime, model } = await createPiModel({
      providerName: 'azure-openai',
      modelId,
      env: { AZURE_OPENAI_API_KEY: 'azure-selected-fixture-key' },
    })
    expect(model).toMatchObject({ provider: 'azure', id: modelId, api })
    expect(JSON.stringify(await runtime.getAuth(model))).toContain('azure-selected-fixture-key')
  }
})

test('an uncatalogued model id with no endpoint is refused instead of misrouted', async () => {
  await expect(
    createPiModel({ providerName: 'groq', modelId: 'not-a-model', env: { GROQ_API_KEY: 'g' } }),
  ).rejects.toThrow(/Unknown model "not-a-model" for provider "groq"/)
})

test('a catalogued model keeps its own endpoint and protocol', async () => {
  const { model } = await createPiModel({
    providerName: 'kimi-coding',
    modelId: 'kimi-for-coding',
    env: {},
  })
  expect(model).toMatchObject({
    provider: 'kimi-coding',
    api: 'openai-completions',
    baseUrl: 'https://api.kimi.com/coding/v1',
  })
  // Fireworks catalogs both protocols, each at its own path.
  const chat = await createPiModel({
    providerName: 'fireworks',
    modelId: 'accounts/fireworks/models/kimi-k3',
    env: {},
  })
  expect(chat.model).toMatchObject({
    api: 'openai-completions',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
  })
})

test('a model newer than the catalog stays on Fireworks’ own endpoint', async () => {
  const { model } = await createPiModel({
    providerName: 'fireworks',
    modelId: 'accounts/fireworks/models/fixture-next-model',
    env: {},
  })
  expect(model).toMatchObject({
    provider: 'fireworks',
    api: 'openai-completions',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
  })
})

test('local servers take any model id at their configured or default endpoint', async () => {
  const configured = await createPiModel({
    providerName: 'lmstudio',
    modelId: 'some-locally-loaded-model',
    env: { LMSTUDIO_URL: 'http://127.0.0.1:9999/v1' },
  })
  expect(configured.model).toMatchObject({
    provider: 'lmstudio',
    baseUrl: 'http://127.0.0.1:9999/v1',
  })
  const ollama = await createPiModel({ providerName: 'ollama', modelId: 'qwen3', env: {} })
  expect(ollama.model.baseUrl).toBe('http://127.0.0.1:11434/v1')
})

test('an operator endpoint applies to catalogued models too', async () => {
  const { model } = await createPiModel({
    providerName: 'vercel-ai-gateway',
    modelId: 'alibaba/qwen-3-14b',
    env: { AI_GATEWAY_BASE_URL: 'https://gateway.internal/v1' },
  })
  expect(model.baseUrl).toBe('https://gateway.internal/v1')
})

test('the provider test sends one real request through the same runtime', async () => {
  const seen: Array<{ path: string; auth: string | null; body: unknown }> = []
  mock = await startMockServer(async (req) => {
    seen.push({
      path: new URL(req.url).pathname,
      auth: req.headers.get('authorization'),
      body: await req.json(),
    })
    const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`
    return new Response(
      chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' } }] }) +
        chunk({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        }) +
        'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })

  await expect(
    testProviderModel({
      providerName: 'lmstudio',
      modelId: 'loaded-model',
      env: { LMSTUDIO_URL: `${mock.url}/v1` },
      message: 'say hi',
    }),
  ).resolves.toEqual({ content: 'hello', usage: { promptTokens: 7, completionTokens: 2 } })
  expect(seen[0]).toMatchObject({ path: '/v1/chat/completions', body: { model: 'loaded-model' } })
  expect(JSON.stringify(seen[0]?.body)).toContain('say hi')

  await testProviderModel({
    providerName: 'fireworks',
    modelId: 'accounts/fixture/models/upstream',
    env: { FIREWORKS_API_KEY: 'fireworks-key' },
    baseUrl: `${mock.url}/v1`,
    message: 'say hi',
  })
  expect(seen[1]).toMatchObject({ path: '/v1/chat/completions', auth: 'Bearer fireworks-key' })
})

test('a failed provider request is reported, not returned as a reply', async () => {
  mock = await startMockServer(() => new Response('invalid api key', { status: 401 }))
  await expect(
    testProviderModel({
      providerName: 'lmstudio',
      modelId: 'loaded-model',
      env: { LMSTUDIO_URL: `${mock.url}/v1` },
      message: 'say hi',
    }),
  ).rejects.toThrow(/401|invalid api key/)
})

test('provider facts: model strings, credentials and live model listings', () => {
  expect(parseModelString('ollama:qwen3:8b')).toEqual({
    providerName: 'ollama',
    modelId: 'qwen3:8b',
  })
  expect(() => parseModelString('no-provider')).toThrow(/provider:model/)

  expect(isProviderConfigured('openai', {})).toBe(false)
  expect(isProviderConfigured('openai', { OPENAI_API_KEY: 'k' })).toBe(true)
  expect(isProviderConfigured('lmstudio', {})).toBe(true)
  expect(isProviderConfigured('bedrock', { AWS_REGION: 'us-east-1' })).toBe(false)
  expect(isProviderConfigured('bedrock', { AWS_PROFILE: 'work' })).toBe(true)
  expect(isProviderConfigured('cloudflare-workers-ai', { CLOUDFLARE_API_KEY: 'k' })).toBe(false)
  expect(isProviderConfigured('not-a-provider', { OPENAI_API_KEY: 'k' })).toBe(false)

  expect(providerModelsUrl('ollama', {})).toBe('http://127.0.0.1:11434/v1')
  expect(providerModelsUrl('lmstudio', { LMSTUDIO_URL: 'http://lan:1234/v1' })).toBe(
    'http://lan:1234/v1',
  )
  expect(providerModelsUrl('vercel-ai-gateway', {})).toBe('https://ai-gateway.vercel.sh/v1')
  expect(providerModelsUrl('anthropic', {})).toBeUndefined()
})
