import type {
  ConnectProviderResponse,
  LocalProvidersResponse,
  ModelsResponse,
  ProviderCatalogResponse,
  ProviderConfigEntry,
  ProviderConfigResponse,
  TestProviderResponse,
} from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import {
  createProfile,
  isSetupComplete,
  mergeSecretsIntoEnv,
  openConfig,
  openSecrets,
  profileRepo,
  providerModelRepo,
  providerStateRepo,
} from '../../src/core/index.ts'
import { readProviderChecks } from '../../src/core/provider-checks.ts'
import { PROVIDERS } from '../../src/core/providers.ts'
import { configRouter } from '../../src/routes/config.ts'
import { saveLoginCredentials } from '../../src/runtime/auth/openai-codex.ts'
import { listCatalogModelsSync } from '../../src/runtime/providers/catalog.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { type MockServer, startMockServer } from '../runtime/mock-server.ts'

let env: TestEnv
let mock: MockServer | undefined
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))

const SETTINGS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_GATEWAY_ID',
  'LMSTUDIO_URL',
  'LMSTUDIO_API_KEY',
  'OLLAMA_URL',
  'LLAMACPP_URL',
  'MISTRAL_API_KEY',
  'BAZILION_IMAGE_MODEL',
]

beforeEach(() => {
  env = makeTestEnv()
  for (const name of SETTINGS) vi.stubEnv(name, undefined)
})
afterEach(async () => {
  await mock?.stop()
  mock = undefined
  env.cleanup()
  vi.unstubAllEnvs()
})

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const get = async <T>(path: string) => (await (await configRouter.request(path)).json()) as T
const connect = async (id: string, body: unknown) =>
  (await (
    await configRouter.request(`/providers/${id}/connect`, json('POST', body))
  ).json()) as ConnectProviderResponse
const provider = async (id: string) =>
  (await get<ProviderConfigResponse>('/providers')).providers.find(
    (entry) => entry.id === id,
  ) as ProviderConfigEntry

/** An OpenAI-compatible server: a model list, and a reply or a canned failure per model. */
async function modelServer(
  options: {
    models?: string[]
    fail?: Record<string, { status: number; body: unknown }>
    asked?: string[]
    keys?: (string | null)[]
  } = {},
) {
  mock = await startMockServer(async (request) => {
    const path = new URL(request.url).pathname
    options.keys?.push(request.headers.get('authorization'))
    if (path.endsWith('/models')) {
      return Response.json({ data: (options.models ?? ['qwen3-coder-30b']).map((id) => ({ id })) })
    }
    const model = ((await request.json()) as { model: string }).model
    options.asked?.push(model)
    const failure = options.fail?.[model]
    if (failure) return Response.json(failure.body, { status: failure.status })
    const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`
    return new Response(
      `${chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' } }] })}${chunk(
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        },
      )}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  return `${mock.url}/v1`
}

test('connecting saves the fields, switches the provider on and remembers the test', async () => {
  const asked: string[] = []
  const url = await modelServer({ models: ['qwen3-coder-30b', 'gemma-3-12b'], asked })
  expect((await provider('lmstudio')).state).toBe('off')
  expect(isSetupComplete(env.db)).toBe(false)

  const result = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: url },
    models: ['qwen3-coder-30b'],
  })
  if (!result.connected) throw new Error(result.failure.title)
  expect(asked).toEqual(['qwen3-coder-30b'])
  expect(result.check).toMatchObject({ ok: true, model: 'qwen3-coder-30b' })
  expect(result.dropped).toEqual([])
  expect(result.provider).toMatchObject({
    id: 'lmstudio',
    connect: 'local',
    enabled: true,
    listed: true,
    state: 'working',
    models: ['qwen3-coder-30b'],
    address: url,
  })
  expect(openConfig(env.db).get('LMSTUDIO_URL')).toBe(url)
  expect(providerStateRepo.listEnabled(env.db).has('lmstudio')).toBe(true)
  // The first working provider also makes the default Team and template.
  expect(isSetupComplete(env.db)).toBe(true)
  expect(profileRepo.get(env.db, 'default')?.defaultModel).toBe('lmstudio:qwen3-coder-30b')
  // The record of tests is state: it never reaches a turn's or a tool's environment.
  expect(Object.keys(readProviderChecks(env.db))).toEqual(['lmstudio'])
  expect(mergeSecretsIntoEnv(env.db, 'test-only', {})).not.toHaveProperty('PROVIDER_CHECKS')
})

test('a key the provider rejects is not saved and switches nothing on', async () => {
  const keys: (string | null)[] = []
  const url = await modelServer({
    keys,
    fail: {
      'qwen3-coder-30b': {
        status: 401,
        body: {
          error: { message: 'Incorrect API key provided: wrong-key-123', code: 'invalid_api_key' },
        },
      },
    },
  })
  const result = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: url, LMSTUDIO_API_KEY: 'wrong-key-123' },
    models: ['qwen3-coder-30b'],
  })
  expect(result.connected).toBe(false)
  if (result.connected) return
  expect(result.failure.kind).toBe('credentials')
  expect(result.failure.title).toBe('LM Studio asked for a key it did not get')
  // The provider's own words stay as the detail, without the key.
  expect(result.failure.detail).toContain('Incorrect API key provided')
  expect(result.failure.detail).not.toContain('wrong-key-123')
  expect(keys).toContain('Bearer wrong-key-123')
  expect(openConfig(env.db).get('LMSTUDIO_URL')).toBeUndefined()
  expect(openSecrets(env.db, 'test-only').get('LMSTUDIO_API_KEY')).toBeUndefined()
  expect(await provider('lmstudio')).toMatchObject({ enabled: false, listed: false, state: 'off' })
  expect(isSetupComplete(env.db)).toBe(false)

  // The same request without a test saves it, untested.
  const saved = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: url },
    models: ['qwen3-coder-30b'],
    test: false,
  })
  expect(saved).toMatchObject({ connected: true, check: null, provider: { state: 'untested' } })
})

test('a server that is off, and a missing key, are said in plain words', async () => {
  const off = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: 'http://127.0.0.1:1/v1' },
    models: ['qwen3-coder-30b'],
  })
  expect(off).toMatchObject({
    connected: false,
    failure: {
      kind: 'unreachable',
      title: 'Nothing answers at 127.0.0.1:1',
      hint: 'Start LM Studio and switch its server on, then try again.',
    },
  })

  // With no model to ask, a server that is off is still said to be off, and nothing is saved.
  const offUnnamed = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: 'http://127.0.0.1:1/v1' },
    models: [],
  })
  expect(offUnnamed).toMatchObject({
    connected: false,
    failure: { kind: 'unreachable', title: 'Nothing answers at 127.0.0.1:1' },
  })
  expect(openConfig(env.db).get('LMSTUDIO_URL')).toBeUndefined()
  expect(await provider('lmstudio')).toMatchObject({ enabled: false, state: 'off' })
  // A server that answers with an empty list has nothing to ask either.
  const empty = await modelServer({ models: [] })
  expect(await connect('ollama', { fields: { OLLAMA_URL: empty } })).toMatchObject({
    connected: false,
    failure: { kind: 'model', title: 'Ollama lists no models' },
  })
  expect((await provider('ollama')).enabled).toBe(false)
  // A hosted provider without suggestions needs its models named, and is not asked for a list.
  expect(await connect('mistral', { fields: { MISTRAL_API_KEY: 'made-up' } })).toMatchObject({
    connected: false,
    failure: { kind: 'model', title: 'No chat model was chosen for Mistral' },
  })
  expect(openSecrets(env.db, 'test-only').get('MISTRAL_API_KEY')).toBeUndefined()
  // Saving without a test stays possible with no model.
  const unasked = await connect('ollama', { fields: { OLLAMA_URL: empty }, test: false })
  expect(unasked).toMatchObject({ connected: true, check: null })
  expect(await provider('ollama')).toMatchObject({ enabled: true, state: 'untested', models: [] })

  const noKey = await connect('anthropic', { models: ['claude-haiku-5-5'] })
  expect(noKey).toMatchObject({
    connected: false,
    failure: { kind: 'credentials', title: 'Anthropic needs its API key' },
  })
  const chatgpt = await connect('openai-codex', {})
  expect(chatgpt).toMatchObject({
    connected: false,
    failure: { kind: 'credentials', title: 'ChatGPT is not signed in' },
  })
  expect((await configRouter.request('/providers/nope/connect', json('POST', {}))).status).toBe(404)
  expect(
    (
      await configRouter.request(
        '/providers/anthropic/connect',
        json('POST', { fields: { OPENAI_API_KEY: 'x' } }),
      )
    ).status,
  ).toBe(400)
})

test('a model the account cannot use is left out and the next one is asked', async () => {
  const asked: string[] = []
  const url = await modelServer({
    asked,
    fail: {
      'first-model': {
        status: 404,
        body: {
          error: {
            message: 'The model `first-model` does not exist or you do not have access to it.',
            code: 'model_not_found',
          },
        },
      },
    },
  })
  const result = await connect('lmstudio', {
    fields: { LMSTUDIO_URL: url },
    models: ['first-model', 'second-model'],
  })
  if (!result.connected) throw new Error(result.failure.title)
  expect(asked).toEqual(['first-model', 'second-model'])
  expect(result.dropped.map((entry) => entry.model)).toEqual(['first-model'])
  expect(result.check).toMatchObject({ ok: true, model: 'second-model' })
  expect(result.provider.models).toEqual(['second-model'])

  // When every model is refused, nothing is saved.
  const refused = await connect('ollama', {
    fields: { OLLAMA_URL: url },
    models: ['first-model'],
  })
  expect(refused).toMatchObject({ connected: false, failure: { kind: 'model' } })
  expect(await provider('ollama')).toMatchObject({ enabled: false, models: [] })
})

test('testing again records a failure, and a later success replaces it', async () => {
  const fail: Record<string, { status: number; body: unknown }> = {}
  const url = await modelServer({ fail })
  await connect('lmstudio', { fields: { LMSTUDIO_URL: url }, models: ['qwen3-coder-30b'] })

  fail['qwen3-coder-30b'] = {
    status: 429,
    body: { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } },
  }
  const failed = (await (
    await configRouter.request('/providers/lmstudio/test', json('POST'))
  ).json()) as TestProviderResponse
  expect(failed.check).toMatchObject({ ok: false, failure: { kind: 'limit' } })
  expect(failed.provider.state).toBe('failing')
  expect((await provider('lmstudio')).check?.failure?.title).toBe(
    'LM Studio accepted the key but refused the request',
  )

  delete fail['qwen3-coder-30b']
  const passed = (await (
    await configRouter.request('/providers/lmstudio/test', json('POST'))
  ).json()) as TestProviderResponse
  expect(passed.provider.state).toBe('working')

  // Changing a stored field makes the earlier proof worthless.
  await configRouter.request('/fields/LMSTUDIO_API_KEY', json('PUT', { value: 'a-new-key' }))
  expect((await provider('lmstudio')).state).toBe('untested')
  // A provider with no chat model has nothing to ask.
  expect((await configRouter.request('/providers/ollama/test', json('POST'))).status).toBe(409)
})

test('a provider cannot be switched on without credentials, and can be paused with them', async () => {
  const put = (id: string, enabled: boolean) =>
    configRouter.request(`/providers/${id}/enabled`, json('PUT', { enabled }))
  const refused = await put('anthropic', true)
  expect(refused.status).toBe(409)
  expect(((await refused.json()) as { error: string }).error).toContain(
    'bazilion provider connect anthropic',
  )

  openSecrets(env.db, 'test-only').set('ANTHROPIC_API_KEY', 'sk-ant-test')
  providerModelRepo.replace(env.db, 'anthropic', ['claude-haiku-5-5'])
  expect(await provider('anthropic')).toMatchObject({
    configured: true,
    listed: true,
    state: 'off',
  })
  expect((await put('anthropic', true)).status).toBe(200)
  expect((await provider('anthropic')).state).toBe('untested')
  expect((await put('anthropic', false)).status).toBe(200)
  expect((await provider('anthropic')).state).toBe('off')

  // Switched on, then the key removed: the page says what is missing instead of "enabled".
  await put('anthropic', true)
  await configRouter.request('/fields/ANTHROPIC_API_KEY', { method: 'DELETE' })
  expect(await provider('anthropic')).toMatchObject({ enabled: true, state: 'incomplete' })
  expect((await put('nope', true)).status).toBe(404)
})

test('disconnecting forgets the credentials, the models and the test, and moves templates', async () => {
  const url = await modelServer()
  await connect('lmstudio', { fields: { LMSTUDIO_URL: url }, models: ['qwen3-coder-30b'] })
  openSecrets(env.db, 'test-only').set('ANTHROPIC_API_KEY', 'sk-ant-test')
  providerModelRepo.replace(env.db, 'anthropic', ['claude-haiku-5-5'])
  providerStateRepo.setEnabled(env.db, 'anthropic', true)

  const response = await configRouter.request('/providers/lmstudio', { method: 'DELETE' })
  expect(await response.json()).toEqual({
    models: [],
    movedTemplates: [{ id: 'default', name: 'Default', model: 'anthropic:claude-haiku-5-5' }],
  })
  expect(await provider('lmstudio')).toMatchObject({
    enabled: false,
    listed: false,
    models: [],
    state: 'off',
  })
  expect(openConfig(env.db).get('LMSTUDIO_URL')).toBeUndefined()
  expect(readProviderChecks(env.db)).toEqual({})

  // A key two providers read stays while the other one is switched on.
  const secrets = openSecrets(env.db, 'test-only')
  secrets.set('CLOUDFLARE_API_KEY', 'cf-key')
  openConfig(env.db).set('CLOUDFLARE_ACCOUNT_ID', 'account')
  openConfig(env.db).set('CLOUDFLARE_GATEWAY_ID', 'gateway')
  providerStateRepo.setEnabled(env.db, 'cloudflare-ai-gateway', true)
  providerStateRepo.setEnabled(env.db, 'cloudflare-workers-ai', true)
  await configRouter.request('/providers/cloudflare-ai-gateway', { method: 'DELETE' })
  expect(secrets.get('CLOUDFLARE_API_KEY')).toBe('cf-key')
  expect(openConfig(env.db).get('CLOUDFLARE_GATEWAY_ID')).toBeUndefined()
  await configRouter.request('/providers/cloudflare-workers-ai', { method: 'DELETE' })
  expect(secrets.get('CLOUDFLARE_API_KEY')).toBeUndefined()

  // ChatGPT: the sign-in goes too.
  saveLoginCredentials(env.db, 'test-only', {
    access: 'oauth-access',
    refresh: 'oauth-refresh',
    expires: Date.now() + 3_600_000,
  })
  expect(await provider('openai-codex')).toMatchObject({ configured: true, listed: true })
  await configRouter.request('/providers/openai-codex', { method: 'DELETE' })
  expect(await provider('openai-codex')).toMatchObject({ configured: false, listed: false })
})

test('the catalog carries names, sizes and prices; a local server lists what it has', async () => {
  const anthropic = await get<ProviderCatalogResponse>('/providers/anthropic/catalog')
  const fable = anthropic.models.find((model) => model.id === 'claude-fable-5-2')
  expect(fable).toMatchObject({
    name: 'Claude Fable 5.2',
    images: true,
    reasoning: true,
    suggested: true,
    selected: false,
  })
  expect(fable?.contextWindow).toBeGreaterThan(100_000)
  expect(fable?.price?.output).toBeGreaterThan(fable?.price?.input ?? 0)
  // A dated copy is marked, and its undated twin loses Pi's "(latest)".
  const dated = anthropic.models.filter((model) => model.dated).map((model) => model.id)
  expect(dated).toContain('claude-haiku-4-5-20251001')
  expect(anthropic.models.find((model) => model.id === 'claude-haiku-4-5')?.name).toBe(
    'Claude Haiku 4.5',
  )
  // Image models are not chat models.
  const openrouter = await get<ProviderCatalogResponse>('/providers/openrouter/catalog')
  expect(openrouter.models.map((model) => model.id)).not.toContain('openai/gpt-image-2')

  const url = await modelServer({ models: ['qwen3-coder-30b', 'gemma-3-12b'] })
  const typed = (await (
    await configRouter.request(
      '/providers/lmstudio/catalog',
      json('POST', { fields: { LMSTUDIO_URL: url } }),
    )
  ).json()) as ProviderCatalogResponse
  expect(typed.models).toEqual([
    { id: 'qwen3-coder-30b', selected: false, suggested: true },
    { id: 'gemma-3-12b', selected: false, suggested: false },
  ])
  // Nothing was saved by looking.
  expect(openConfig(env.db).get('LMSTUDIO_URL')).toBeUndefined()

  const down = (await (
    await configRouter.request(
      '/providers/lmstudio/catalog',
      json('POST', { fields: { LMSTUDIO_URL: 'http://127.0.0.1:1/v1' } }),
    )
  ).json()) as ProviderCatalogResponse
  expect(down.models).toEqual([])
  expect(down.listError).toBeTruthy()
})

test('local servers are found at their addresses', async () => {
  const url = await modelServer({ models: ['qwen3-coder-30b'] })
  vi.stubEnv('LMSTUDIO_URL', url)
  vi.stubEnv('OLLAMA_URL', 'http://127.0.0.1:1/v1')
  vi.stubEnv('LLAMACPP_URL', 'http://127.0.0.1:1/v1')
  const { servers } = await get<LocalProvidersResponse>('/providers/local')
  expect(servers.map((server) => [server.id, server.found, server.models])).toEqual([
    ['lmstudio', true, ['qwen3-coder-30b']],
    ['ollama', false, []],
    ['llamacpp', false, []],
  ])
  expect(servers[0]?.address).toBe(url)
})

test('the models overview lists chat models with who uses them, and the image routes', async () => {
  const url = await modelServer()
  await connect('lmstudio', { fields: { LMSTUDIO_URL: url }, models: ['qwen3-coder-30b'] })
  openSecrets(env.db, 'test-only').set('ANTHROPIC_API_KEY', 'sk-ant-test')
  providerModelRepo.replace(env.db, 'anthropic', ['claude-fable-5-2', 'claude-haiku-5-5'])
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  createProfile(env.db, env.paths, {
    id: 'writer',
    name: 'Writer',
    defaultModel: 'anthropic:claude-haiku-5-5',
  })
  spawnAgent(env.db, env.paths, { profileId: 'writer', teamId: env.teamId })
  spawnAgent(env.db, env.paths, {
    profileId: 'writer',
    teamId: env.teamId,
    modelOverride: 'anthropic:claude-fable-5-2',
  })

  const overview = await get<ModelsResponse>('/models')
  expect(overview.chat.map((model) => [model.value, model.usedBy])).toEqual([
    ['anthropic:claude-fable-5-2', { agents: 1, templates: [] }],
    ['anthropic:claude-haiku-5-5', { agents: 1, templates: ['Writer'] }],
    ['lmstudio:qwen3-coder-30b', { agents: 0, templates: ['Default'] }],
  ])
  expect(overview.chat[0]).toMatchObject({
    name: 'Claude Fable 5.2',
    providerName: 'Anthropic',
    providerState: 'untested',
    providerConnect: 'fields',
  })
  expect(overview.chat[2]).toMatchObject({ providerState: 'working', providerConnect: 'local' })
  expect(overview.chat[2]?.name).toBeUndefined()

  expect(overview.images.selected).toBe('off')
  expect(overview.images.routes.map((route) => [route.id, route.ready, route.needs])).toEqual([
    ['openai-codex:gpt-image-2', false, 'a ChatGPT sign-in'],
    ['openai:gpt-image-2', false, 'an OpenAI API key'],
    ['openrouter:google/gemini-3.1-flash-image', false, 'an OpenRouter API key'],
    ['openrouter:openai/gpt-image-2', false, 'an OpenRouter API key'],
  ])
  openSecrets(env.db, 'test-only').set('OPENROUTER_API_KEY', 'sk-or-test')
  await configRouter.request(
    '/fields/BAZILION_IMAGE_MODEL',
    json('PUT', { value: 'openrouter:openai/gpt-image-2' }),
  )
  const images = (await get<ModelsResponse>('/models')).images
  expect(images.selected).toBe('openrouter:openai/gpt-image-2')
  expect(images.routes.filter((route) => route.ready).map((route) => route.provider)).toEqual([
    'openrouter',
    'openrouter',
  ])

  // Changing the chat models of a provider keeps a test that named a model still in the list.
  const put = (models: string[]) =>
    configRouter.request('/providers/lmstudio/models', json('PUT', { models }))
  await put(['qwen3-coder-30b', 'gemma-3-12b'])
  expect((await provider('lmstudio')).state).toBe('working')
  await put(['gemma-3-12b'])
  expect((await provider('lmstudio')).state).toBe('untested')
  expect((await put(['x'])).status).toBe(200)
  expect(
    (
      await configRouter.request(
        '/providers/openrouter/models',
        json('PUT', { models: ['openai/gpt-image-2'] }),
      )
    ).status,
  ).toBe(400)
})

test('every provider has a group; suggested models exist in the bundled catalog', async () => {
  const { providers } = await get<ProviderConfigResponse>('/providers')
  expect(providers).toHaveLength(PROVIDERS.length)
  expect(providers.filter((entry) => entry.group === 'popular').map((entry) => entry.id)).toEqual([
    'openai-codex',
    'openai',
    'anthropic',
    'google',
    'openrouter',
  ])
  expect(providers.filter((entry) => entry.group === 'local').map((entry) => entry.id)).toEqual([
    'lmstudio',
    'ollama',
    'llamacpp',
  ])
  expect(providers.every((entry) => !entry.listed && entry.state === 'off')).toBe(true)
  expect(providers.find((entry) => entry.id === 'openai-codex')?.connect).toBe('signin')
  // Fails after a Pi upgrade that drops a suggested model: choose its successor in providers.ts.
  for (const entry of PROVIDERS) {
    const catalog = listCatalogModelsSync(entry.id)
    expect(
      (entry.suggested ?? []).filter((model) => !catalog.includes(model)),
      `suggested models of ${entry.id}`,
    ).toEqual([])
  }
})
