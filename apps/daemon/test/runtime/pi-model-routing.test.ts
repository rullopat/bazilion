import { afterEach, expect, test, vi } from 'vitest'
import {
  isProviderConfigured,
  parseModelString,
  providerModelsUrl,
} from '../../src/core/providers.ts'
import { compactionFor } from '../../src/runtime/pi/session.ts'
import {
  createPiModel,
  rememberLocalModelWindow,
  serverContextWindow,
  testProviderModel,
  turnContextWindow,
} from '../../src/runtime/providers/pi-runtime.ts'
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

test('a model newer than the catalog stays on Fireworks’ own endpoint, with the window set for it', async () => {
  const spec = {
    providerName: 'fireworks',
    modelId: 'accounts/fireworks/models/fixture-next-model',
    env: {},
  }
  // Nothing says its window: a turn on it is refused until one is set.
  await expect(createPiModel(spec)).rejects.toThrow(
    /not in Fireworks AI's catalog, so its context window is unknown, and none is set for it\. Set it in Setup → Models/,
  )
  const { model } = await createPiModel({ ...spec, contextWindow: 131_072 })
  expect(model).toMatchObject({
    provider: 'fireworks',
    api: 'openai-completions',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    contextWindow: 131_072,
    // A reply may use what the window leaves; Pi fits each request's limit into it.
    maxTokens: 131_072,
  })
})

test('local servers take any model id at their configured or default endpoint', async () => {
  const configured = await createPiModel({
    providerName: 'lmstudio',
    modelId: 'some-locally-loaded-model',
    env: { LMSTUDIO_URL: 'http://127.0.0.1:9999/v1' },
    contextWindow: 8_192,
  })
  expect(configured.model).toMatchObject({
    provider: 'lmstudio',
    baseUrl: 'http://127.0.0.1:9999/v1',
  })
  const ollama = await createPiModel({
    providerName: 'ollama',
    modelId: 'qwen3',
    env: { OLLAMA_URL: 'http://127.0.0.1:1/v1' },
    contextWindow: 8_192,
  })
  expect(ollama.model.baseUrl).toBe('http://127.0.0.1:1/v1')
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
      body: await req
        .text()
        .then((text) => (text ? JSON.parse(text) : undefined))
        .catch(() => undefined),
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
  // The test needs no window: its one request is the only one, for a model nothing sized.
  expect(seen).toHaveLength(1)
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

/** A stand-in local server answering only its own model listing. */
async function serverListing(path: string, body: unknown): Promise<void> {
  mock = await startMockServer((req) => {
    const url = new URL(req.url)
    return url.pathname === path
      ? Response.json(body)
      : new Response(`unexpected path: ${url.pathname}`, { status: 404 })
  })
}

test('llama.cpp says the window it was started with, by id or alias', async () => {
  await serverListing('/v1/models', {
    object: 'list',
    data: [
      { id: 'windowed-model', aliases: ['the-alias'], object: 'model', meta: { n_ctx: 196_608 } },
    ],
  })
  const env = { LLAMACPP_URL: `${mock?.url}/v1` }
  for (const modelId of ['windowed-model', 'the-alias']) {
    const { model } = await createPiModel({ providerName: 'llamacpp', modelId, env })
    expect(model.contextWindow).toBe(196_608)
    expect(model.maxTokens).toBe(196_608)
  }
})

test('LM Studio says the window a model is loaded with', async () => {
  await serverListing('/api/v1/models', {
    models: [
      { key: 'idle-model', loaded_instances: [], max_context_length: 262_144 },
      {
        key: 'qwen/qwen3-8b',
        loaded_instances: [{ id: 'qwen/qwen3-8b', config: { context_length: 40_960 } }],
        max_context_length: 131_072,
      },
    ],
  })
  const env = { LMSTUDIO_URL: `${mock?.url}/v1` }
  const loaded = await createPiModel({ providerName: 'lmstudio', modelId: 'qwen/qwen3-8b', env })
  expect(loaded.model.contextWindow).toBe(40_960)
  // A model that is not loaded has no window yet; the most it could take is not it.
  await expect(
    createPiModel({ providerName: 'lmstudio', modelId: 'idle-model', env }),
  ).rejects.toThrow(
    /LM Studio did not say the context window of idle-model \(it does once the model is loaded\), and none is set for it\. Set it in Setup → Models, or run `bazilion provider window lmstudio:idle-model <tokens>`/,
  )
  const set = await createPiModel({
    providerName: 'lmstudio',
    modelId: 'idle-model',
    env,
    contextWindow: 16_384,
  })
  expect(set.model.contextWindow).toBe(16_384)
})

test('Ollama says the window of a running model, with or without its tag', async () => {
  await serverListing('/api/ps', {
    models: [{ name: 'qwen3:latest', model: 'qwen3:latest', context_length: 32_768 }],
  })
  const env = { OLLAMA_URL: `${mock?.url}/v1` }
  for (const modelId of ['qwen3', 'qwen3:latest']) {
    const { model } = await createPiModel({ providerName: 'ollama', modelId, env })
    expect(model.contextWindow).toBe(32_768)
  }
  await expect(createPiModel({ providerName: 'ollama', modelId: 'llama4', env })).rejects.toThrow(
    /Ollama did not say the context window of llama4/,
  )
})

test('what the server says wins over the window set by hand', async () => {
  await serverListing('/v1/models', { data: [{ id: 'm', meta: { n_ctx: 65_536 } }] })
  const { model } = await createPiModel({
    providerName: 'llamacpp',
    modelId: 'm',
    env: { LLAMACPP_URL: `${mock?.url}/v1` },
    contextWindow: 8_192,
  })
  expect(model.contextWindow).toBe(65_536)
})

test('a silent or unreachable server takes the window set by hand, or the turn is refused', async () => {
  await serverListing('/v1/models', { data: [{ id: 'bare-model' }] })
  const silent = {
    providerName: 'llamacpp',
    modelId: 'bare-model',
    env: { LLAMACPP_URL: `${mock?.url}/v1` },
  }
  await expect(createPiModel(silent)).rejects.toThrow(
    /llama\.cpp did not say the context window it was started with, and none is set for it/,
  )
  expect((await createPiModel({ ...silent, contextWindow: 24_576 })).model.contextWindow).toBe(
    24_576,
  )
  const unreachable = {
    providerName: 'lmstudio',
    modelId: 'never-reached-model',
    env: { LMSTUDIO_URL: 'http://127.0.0.1:1/v1' },
  }
  await expect(createPiModel(unreachable)).rejects.toThrow(/none is set for it/)
  expect((await createPiModel({ ...unreachable, contextWindow: 12_288 })).model.contextWindow).toBe(
    12_288,
  )
})

test('the daemon shows the window a turn had, else the server’s or the one set by hand', async () => {
  // Nothing known: no window, rather than a guess.
  expect(turnContextWindow('lmstudio:nothing-known', null)).toBeNull()
  expect(turnContextWindow('lmstudio:nothing-known', 20_000)).toBe(20_000)

  await serverListing('/v1/models', { data: [{ id: 'asked-model', meta: { n_ctx: 49_152 } }] })
  await serverContextWindow('llamacpp', 'asked-model', { LLAMACPP_URL: `${mock?.url}/v1` })
  expect(turnContextWindow('llamacpp:asked-model', 8_192)).toBe(49_152)

  rememberLocalModelWindow('lmstudio:remembered-model', 131_072)
  expect(turnContextWindow('lmstudio:remembered-model', 8_192)).toBe(131_072)
  // A hosted model keeps its catalog window; remembering one is a no-op.
  rememberLocalModelWindow('openai-codex:gpt-6.2-astra', 1)
  expect(turnContextWindow('openai-codex:gpt-6.2-astra', null)).toBe(272_000)
  expect(turnContextWindow('fireworks:accounts/x/models/uncatalogued', null)).toBeNull()
  expect(turnContextWindow('fireworks:accounts/x/models/uncatalogued', 65_536)).toBe(65_536)
})

test('the window a turn reported is still the one shown after a quiet while', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    rememberLocalModelWindow('lmstudio:quiet-model', 98_304)
    // The meter and chat-context read it long after the turn, until the next turn reports one.
    vi.setSystemTime(Date.now() + 60 * 60_000)
    expect(turnContextWindow('lmstudio:quiet-model', null)).toBe(98_304)
  } finally {
    vi.useRealTimers()
  }
})

test('compaction is sized to the window: a quarter of a small one, Pi’s defaults for a large one', () => {
  expect(compactionFor(32_768)).toEqual({
    enabled: true,
    reserveTokens: 8_192,
    keepRecentTokens: 8_192,
  })
  expect(compactionFor(196_608)).toEqual({
    enabled: true,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  })
})
