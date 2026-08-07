import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vitest'
import { piProvider } from '../../src/runtime/providers/pi-adapter.ts'
import {
  createProviderRegistry,
  loadProviderConfigFromEnv,
} from '../../src/runtime/providers/registry.ts'

// These tests cover the pi-ai adapter's semantics — message/tool/response
// conversion and delta plumbing — by registering a fake pi `Api` that returns
// canned event streams. Wire-format correctness (SSE framing, provider-specific
// request shapes) is pi-ai's responsibility and covered by its own test suite.

test('Pi 0.83 catalog includes the refreshed model families and Qwen providers', () => {
  expect(getBuiltinModels('openai-codex').map((model) => model.id)).toContain('gpt-5.6-sol')
  expect(getBuiltinModels('anthropic').map((model) => model.id)).toContain('claude-opus-5')
  expect(getBuiltinModels('google').map((model) => model.id)).toContain('gemini-3.6-flash')
  expect(getBuiltinModels('qwen-token-plan').map((model) => model.id)).toContain(
    'qwen3.8-max-preview',
  )
  expect(getBuiltinModels('qwen-token-plan-cn').map((model) => model.id)).toContain(
    'qwen3.8-max-preview',
  )
})

function fauxRuntime(response: ReturnType<typeof fauxAssistantMessage>) {
  return async () => {
    const faux = fauxProvider({ provider: 'bazilion-fake', models: [{ id: 'm' }] })
    faux.setResponses([response])
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
    })
    runtime.registerNativeProvider(faux.provider)
    return runtime
  }
}

test('piProvider surfaces text, usage, and stopReason from a completed stream', async () => {
  const provider = piProvider({
    providerName: 'bazilion-fake',
    runtimeFactory: fauxRuntime(fauxAssistantMessage('hello there')),
  })
  const res = await provider.chat({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
  })
  expect(res.content).toBe('hello there')
  expect(res.toolCalls).toEqual([])
  expect(res.stopReason).toBe('stop')
  expect(res.usage?.completionTokens).toBeGreaterThan(0)
})

test('piProvider calls onDelta for each streamed chunk', async () => {
  const provider = piProvider({
    providerName: 'bazilion-fake',
    runtimeFactory: fauxRuntime(fauxAssistantMessage('abcdef')),
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
  const provider = piProvider({
    providerName: 'bazilion-fake',
    runtimeFactory: fauxRuntime(
      fauxAssistantMessage(
        fauxToolCall('memory_write', { key: 'x.md', content: 'y' }, { id: 'call_1' }),
        { stopReason: 'toolUse' },
      ),
    ),
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
  const provider = piProvider({
    providerName: 'bazilion-fake',
    runtimeFactory: fauxRuntime(
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'upstream blew up' }),
    ),
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
    qwenTokenPlan: { apiKey: 'k' },
    qwenTokenPlanCn: { apiKey: 'k' },
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
    'qwen-token-plan',
    'qwen-token-plan-cn',
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
    QWEN_TOKEN_PLAN_API_KEY: 'qw',
    QWEN_TOKEN_PLAN_CN_API_KEY: 'qwcn',
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
  expect(config.qwenTokenPlan?.apiKey).toBe('qw')
  expect(config.qwenTokenPlanCn?.apiKey).toBe('qwcn')
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
