import {
  createAssistantMessageEventStream,
  registerApiProvider,
  unregisterApiProviders,
} from '@earendil-works/pi-ai/compat'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { piProvider } from '../../src/runtime/providers/pi-adapter.ts'
import {
  createProviderRegistry,
  loadProviderConfigFromEnv,
} from '../../src/runtime/providers/registry.ts'

// These tests cover the pi-ai adapter's semantics — message/tool/response
// conversion and delta plumbing — by registering a fake pi `Api` that returns
// canned event streams. Wire-format correctness (SSE framing, provider-specific
// request shapes) is pi-ai's responsibility and covered by its own test suite.

const FAKE_API = 'bazilion-test-fake' as const
const TEST_SRC = 'bazilion-tests'

beforeEach(() => {
  unregisterApiProviders(TEST_SRC)
})
afterEach(() => {
  unregisterApiProviders(TEST_SRC)
})

function registerFakeApi(build: () => ReturnType<typeof createAssistantMessageEventStream>): void {
  registerApiProvider(
    {
      api: FAKE_API,
      stream: () => build(),
      streamSimple: () => build(),
    },
    TEST_SRC,
  )
}

function cannedAssistantText(text: string): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  const assistant = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: FAKE_API,
    provider: 'fake',
    model: 'm',
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  }
  // Push chunked deltas to exercise the delta path, then a terminal done event.
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: assistant })
    stream.push({ type: 'text_start', contentIndex: 0, partial: assistant })
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: text.slice(0, 3),
      partial: assistant,
    })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: text.slice(3), partial: assistant })
    stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: assistant })
    stream.push({ type: 'done', reason: 'stop', message: assistant })
    stream.end(assistant)
  })
  return stream
}

function cannedToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  const assistant = {
    role: 'assistant' as const,
    content: [{ type: 'toolCall' as const, id, name, arguments: args }],
    api: FAKE_API,
    provider: 'fake',
    model: 'm',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse' as const,
    timestamp: Date.now(),
  }
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: assistant })
    stream.push({ type: 'done', reason: 'toolUse', message: assistant })
    stream.end(assistant)
  })
  return stream
}

function cannedError(message: string): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  const assistant = {
    role: 'assistant' as const,
    content: [],
    api: FAKE_API,
    provider: 'fake',
    model: 'm',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error' as const,
    errorMessage: message,
    timestamp: Date.now(),
  }
  queueMicrotask(() => {
    stream.push({ type: 'error', reason: 'error', error: assistant })
    stream.end(assistant)
  })
  return stream
}

test('piProvider surfaces text, usage, and stopReason from a completed stream', async () => {
  registerFakeApi(() => cannedAssistantText('hello there'))
  const provider = piProvider({
    providerName: 'bazilion-fake',
    fallbackApi: FAKE_API,
    apiKey: 'k',
  })
  const res = await provider.chat({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
  })
  expect(res.content).toBe('hello there')
  expect(res.toolCalls).toEqual([])
  expect(res.stopReason).toBe('stop')
  expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
})

test('piProvider calls onDelta for each streamed chunk', async () => {
  registerFakeApi(() => cannedAssistantText('abcdef'))
  const provider = piProvider({
    providerName: 'bazilion-fake',
    fallbackApi: FAKE_API,
    apiKey: 'k',
  })
  const deltas: string[] = []
  const res = await provider.chat({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (d) => deltas.push(d),
  })
  expect(deltas.join('')).toBe('abcdef')
  expect(res.content).toBe('abcdef')
})

test('piProvider extracts toolCalls with JSON-stringified arguments', async () => {
  registerFakeApi(() => cannedToolCall('call_1', 'memory_write', { key: 'x.md', content: 'y' }))
  const provider = piProvider({
    providerName: 'bazilion-fake',
    fallbackApi: FAKE_API,
    apiKey: 'k',
  })
  const res = await provider.chat({
    model: 'm',
    messages: [{ role: 'user', content: 'remember' }],
    tools: [
      {
        name: 'memory_write',
        description: 'write memory',
        parameters: { type: 'object', properties: { key: { type: 'string' } } },
      },
    ],
  })
  expect(res.stopReason).toBe('tool_use')
  expect(res.toolCalls).toHaveLength(1)
  expect(res.toolCalls[0]?.name).toBe('memory_write')
  expect(JSON.parse(res.toolCalls[0]?.arguments ?? '{}')).toEqual({
    key: 'x.md',
    content: 'y',
  })
})

test('piProvider surfaces errorMessage as a thrown Error', async () => {
  registerFakeApi(() => cannedError('upstream blew up'))
  const provider = piProvider({
    providerName: 'bazilion-fake',
    fallbackApi: FAKE_API,
    apiKey: 'k',
  })
  await expect(
    provider.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow(/upstream blew up/)
})

// --- registry ---

test('registry resolves every configured provider:model string', () => {
  const reg = createProviderRegistry({
    anthropic: { apiKey: 'k' },
    openai: { apiKey: 'k' },
    google: { apiKey: 'k' },
    azureOpenai: { apiKey: 'k' },
    bedrock: {},
    googleVertex: {},
    mistral: { apiKey: 'k' },
    groq: { apiKey: 'k' },
    cerebras: { apiKey: 'k' },
    xai: { apiKey: 'k' },
    zai: { apiKey: 'k' },
    huggingface: { apiKey: 'k' },
    openrouter: { apiKey: 'k' },
    vercelAiGateway: { apiKey: 'k' },
    deepseek: { apiKey: 'k' },
    fireworks: { apiKey: 'k' },
    together: { apiKey: 'k' },
    moonshotai: { apiKey: 'k' },
    moonshotaiCn: { apiKey: 'k' },
    kimiCoding: { apiKey: 'k' },
    minimax: { apiKey: 'k' },
    minimaxCn: { apiKey: 'k' },
    xiaomi: { apiKey: 'k' },
    xiaomiTokenPlanAms: { apiKey: 'k' },
    xiaomiTokenPlanCn: { apiKey: 'k' },
    xiaomiTokenPlanSgp: { apiKey: 'k' },
    antLing: { apiKey: 'k' },
    nvidia: { apiKey: 'k' },
    opencode: { apiKey: 'k' },
    opencodeGo: { apiKey: 'k' },
    zaiCodingCn: { apiKey: 'k' },
    githubCopilot: { apiKey: 'k' },
    cloudflareAiGateway: { apiKey: 'k' },
    cloudflareWorkersAi: { apiKey: 'k' },
  })
  for (const p of [
    'anthropic',
    'openai',
    'google',
    'google-vertex',
    'azure-openai',
    'bedrock',
    'mistral',
    'groq',
    'cerebras',
    'xai',
    'zai',
    'huggingface',
    'openrouter',
    'vercel-ai-gateway',
    'deepseek',
    'fireworks',
    'together',
    'moonshotai',
    'moonshotai-cn',
    'kimi-coding',
    'minimax',
    'minimax-cn',
    'xiaomi',
    'xiaomi-token-plan-ams',
    'xiaomi-token-plan-cn',
    'xiaomi-token-plan-sgp',
    'ant-ling',
    'nvidia',
    'opencode',
    'opencode-go',
    'zai-coding-cn',
    'github-copilot',
    'cloudflare-ai-gateway',
    'cloudflare-workers-ai',
    'lmstudio',
    'ollama',
    'llamacpp',
  ]) {
    const r = reg.resolve(`${p}:some-model`)
    expect(r.provider.name).toBe(p)
    expect(r.model).toBe('some-model')
  }
})

test('registry exposes lmstudio and ollama without any env config', () => {
  const reg = createProviderRegistry({})
  const lm = reg.resolve('lmstudio:llama-3-8b')
  expect(lm.provider.name).toBe('lmstudio')
  const ol = reg.resolve('ollama:llama2')
  expect(ol.provider.name).toBe('ollama')
})

test('registry rejects unknown names, malformed strings, and unconfigured providers', () => {
  const reg = createProviderRegistry({})
  expect(() => reg.resolve('martian:foo')).toThrow(/unknown provider/)
  expect(() => reg.resolve('not-a-model')).toThrow(/expected "provider:model"/)
  expect(() => reg.resolve('anthropic:m')).toThrow(/not configured/)
  expect(() => reg.resolve('groq:m')).toThrow(/GROQ_API_KEY/)
})

test('loadProviderConfigFromEnv picks up every standard env var', () => {
  const config = loadProviderConfigFromEnv({
    ANTHROPIC_API_KEY: 'a',
    OPENAI_API_KEY: 'o',
    GEMINI_API_KEY: 'g',
    GROQ_API_KEY: 'gr',
    CEREBRAS_API_KEY: 'ce',
    XAI_API_KEY: 'x',
    MISTRAL_API_KEY: 'mi',
    HF_TOKEN: 'hf',
    OPENROUTER_API_KEY: 'or',
    AI_GATEWAY_API_KEY: 'vg',
    DEEPSEEK_API_KEY: 'ds',
    FIREWORKS_API_KEY: 'fw',
    TOGETHER_API_KEY: 'to',
    MOONSHOT_API_KEY: 'mo',
    MOONSHOT_CN_API_KEY: 'mocn',
    KIMI_API_KEY: 'ki',
    MINIMAX_API_KEY: 'mm',
    MINIMAX_CN_API_KEY: 'mmcn',
    XIAOMI_API_KEY: 'xm',
    XIAOMI_TOKEN_PLAN_AMS_API_KEY: 'xmams',
    XIAOMI_TOKEN_PLAN_CN_API_KEY: 'xmcn',
    XIAOMI_TOKEN_PLAN_SGP_API_KEY: 'xmsgp',
    ANT_LING_API_KEY: 'al',
    NVIDIA_API_KEY: 'nv',
    OPENCODE_API_KEY: 'oc',
    OPENCODE_GO_API_KEY: 'ocgo',
    ZAI_API_KEY: 'z',
    ZAI_CODING_CN_API_KEY: 'zcn',
    COPILOT_GITHUB_TOKEN: 'gh',
  } as NodeJS.ProcessEnv)
  expect(config.anthropic?.apiKey).toBe('a')
  expect(config.openai?.apiKey).toBe('o')
  expect(config.google?.apiKey).toBe('g')
  expect(config.groq?.apiKey).toBe('gr')
  expect(config.cerebras?.apiKey).toBe('ce')
  expect(config.xai?.apiKey).toBe('x')
  expect(config.mistral?.apiKey).toBe('mi')
  expect(config.huggingface?.apiKey).toBe('hf')
  expect(config.openrouter?.apiKey).toBe('or')
  expect(config.vercelAiGateway?.apiKey).toBe('vg')
  expect(config.deepseek?.apiKey).toBe('ds')
  expect(config.fireworks?.apiKey).toBe('fw')
  expect(config.together?.apiKey).toBe('to')
  expect(config.moonshotai?.apiKey).toBe('mo')
  expect(config.moonshotaiCn?.apiKey).toBe('mocn')
  expect(config.kimiCoding?.apiKey).toBe('ki')
  expect(config.minimax?.apiKey).toBe('mm')
  expect(config.minimaxCn?.apiKey).toBe('mmcn')
  expect(config.xiaomi?.apiKey).toBe('xm')
  expect(config.xiaomiTokenPlanAms?.apiKey).toBe('xmams')
  expect(config.xiaomiTokenPlanCn?.apiKey).toBe('xmcn')
  expect(config.xiaomiTokenPlanSgp?.apiKey).toBe('xmsgp')
  expect(config.antLing?.apiKey).toBe('al')
  expect(config.nvidia?.apiKey).toBe('nv')
  expect(config.opencode?.apiKey).toBe('oc')
  expect(config.opencodeGo?.apiKey).toBe('ocgo')
  expect(config.zai?.apiKey).toBe('z')
  expect(config.zaiCodingCn?.apiKey).toBe('zcn')
  expect(config.githubCopilot?.apiKey).toBe('gh')
})

test('loadProviderConfigFromEnv recognizes Bedrock auth via AWS_PROFILE', () => {
  const cfg = loadProviderConfigFromEnv({ AWS_PROFILE: 'default' } as NodeJS.ProcessEnv)
  expect(cfg.bedrock).toBeDefined()
})

test('loadProviderConfigFromEnv requires both project and location for Vertex', () => {
  expect(
    loadProviderConfigFromEnv({ GOOGLE_CLOUD_PROJECT: 'p' } as NodeJS.ProcessEnv).googleVertex,
  ).toBeUndefined()
  expect(
    loadProviderConfigFromEnv({
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    } as NodeJS.ProcessEnv).googleVertex,
  ).toBeDefined()
})
