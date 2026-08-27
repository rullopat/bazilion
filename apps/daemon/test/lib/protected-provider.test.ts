import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openConfig, openSecrets, providerStateRepo } from '../../src/core/index.ts'
import {
  LOCAL_PROVIDERS,
  PROTECTED_PROVIDER_NAMES,
  PROVIDER_API_KEY_ENV,
  PROVIDER_CREDENTIAL_ENV,
} from '../../src/runtime/providers/pi-runtime.ts'
import { listRegisteredProviderNames } from '../../src/runtime/providers/registry.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const resolveAgentApiKey = vi.fn()

vi.mock('../../src/lib/api-key.ts', () => ({ resolveAgentApiKey }))

let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
  resolveAgentApiKey.mockReset()
})

afterEach(() => env.cleanup())

function agent(model = 'openai-codex:gpt-5.6-sol'): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: model,
      reasoningLevel: 'high',
      reviewEnabled: false,
      reviewEveryNTurns: 8,
      reviewModel: null,
      reviewReasoningLevel: 'low',
      reviewTurnsSinceLast: 0,
      status: 'idle',
      dir: env.paths.agentDir('agent-1'),
      teamId: env.teamId,
      telegramTopicId: null,
      telegramMirrorMode: 'minimal',
      telegramIconEmoji: null,
      createdAt: 0,
      archivedAt: null,
    },
    profile: {
      id: 'profile-1',
      name: 'Profile One',
      dir: env.paths.profileDir('profile-1'),
      defaultModel: model,
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model,
    reasoningLevel: 'high',
    team: {
      id: env.teamId,
      name: 'test',
      path: env.paths.teamDir(env.teamId),
      userMd: '',
      telegramTopicNameFormat: null,
      createdAt: 0,
    },
    skills: [],
    privateLessons: [],
  }
}

test('resolves current Codex access, model, reasoning, and required refresher', async () => {
  const refreshApiKey = vi.fn(async () => 'fresh-token')
  resolveAgentApiKey.mockResolvedValue({ apiKey: 'current-token', refreshApiKey })
  providerStateRepo.setEnabled(env.db, 'openai-codex', true)
  const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')

  await expect(
    resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent(), 'low'),
  ).resolves.toEqual({
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      apiKey: 'current-token',
    },
    refreshApiKey,
  })
})

test('fails closed for disabled providers or missing Codex refresh', async () => {
  const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')
  await expect(
    resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent('anthropic:claude')),
  ).rejects.toThrow(/not enabled/)

  await expect(
    resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent()),
  ).rejects.toThrow(/not enabled/)

  providerStateRepo.setEnabled(env.db, 'openai-codex', true)
  resolveAgentApiKey.mockResolvedValue({ apiKey: 'current-token' })
  await expect(
    resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent()),
  ).rejects.toThrow(/bound refresh/)
})

test('accounts exhaustively for every provider in the pinned Pi registry', () => {
  expect([...PROTECTED_PROVIDER_NAMES].sort()).toEqual(listRegisteredProviderNames().sort())
  for (const provider of PROTECTED_PROVIDER_NAMES) {
    expect(
      provider === 'openai-codex' ||
        provider in PROVIDER_API_KEY_ENV ||
        provider in PROVIDER_CREDENTIAL_ENV ||
        provider in LOCAL_PROVIDERS,
      `${provider} has no protected credential projection`,
    ).toBe(true)
  }
})

test('projects only the selected static provider credential and returns it through bound IPC', async () => {
  openSecrets(env.db, 'bootstrap-secret').set('ANTHROPIC_API_KEY', 'anthropic-selected-secret')
  openSecrets(env.db, 'bootstrap-secret').set('OPENAI_API_KEY', 'unrelated-openai-secret')
  providerStateRepo.setEnabled(env.db, 'anthropic', true)
  const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')

  const resolved = await resolveProtectedProviderRuntime(
    env.db,
    'bootstrap-secret',
    agent('anthropic:claude-opus-5'),
  )
  expect(resolved.runtime).toEqual({
    providerName: 'anthropic',
    modelId: 'claude-opus-5',
    reasoningLevel: 'high',
    apiKey: 'anthropic-selected-secret',
  })
  expect(JSON.stringify(resolved.runtime)).not.toContain('unrelated-openai-secret')
  await expect(resolved.refreshApiKey('anthropic')).resolves.toBe('anthropic-selected-secret')
  await expect(resolved.refreshApiKey('openai')).rejects.toThrow('unexpected protected provider')
})

test('local providers admit only explicit loopback HTTP endpoints', async () => {
  providerStateRepo.setEnabled(env.db, 'ollama', true)
  const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')
  const previous = process.env.OLLAMA_URL
  process.env.OLLAMA_URL = 'https://remote.example/v1'
  try {
    await expect(
      resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent('ollama:qwen3')),
    ).rejects.toThrow(/loopback HTTP endpoint/)
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_URL
    else process.env.OLLAMA_URL = previous
  }
})

test('projects explicit Bedrock credentials but rejects ambient profile discovery', async () => {
  providerStateRepo.setEnabled(env.db, 'bedrock', true)
  const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')
  const names = [
    'AWS_PROFILE',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
  ] as const
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    process.env.AWS_PROFILE = 'ambient-profile'
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    await expect(
      resolveProtectedProviderRuntime(env.db, 'bootstrap-secret', agent('bedrock:claude')),
    ).rejects.toThrow(/profiles are not read/)

    process.env.AWS_ACCESS_KEY_ID = 'selected-access-id'
    process.env.AWS_SECRET_ACCESS_KEY = 'selected-secret-key'
    process.env.AWS_SESSION_TOKEN = 'selected-session-token'
    process.env.AWS_REGION = 'eu-central-1'
    const resolved = await resolveProtectedProviderRuntime(
      env.db,
      'bootstrap-secret',
      agent('bedrock:claude'),
    )
    expect(resolved.runtime.apiKey).toBeUndefined()
    expect(resolved.runtime.credentialEnv).toEqual(
      expect.arrayContaining([
        { name: 'AWS_ACCESS_KEY_ID', value: 'selected-access-id' },
        { name: 'AWS_SECRET_ACCESS_KEY', value: 'selected-secret-key' },
        { name: 'AWS_SESSION_TOKEN', value: 'selected-session-token' },
        { name: 'AWS_REGION', value: 'eu-central-1' },
      ]),
    )
    expect(JSON.stringify(resolved.runtime)).not.toContain('ambient-profile')
  } finally {
    for (const name of names) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('projects explicit Vertex JSON without exposing an ambient ADC path', async () => {
  providerStateRepo.setEnabled(env.db, 'google-vertex', true)
  openConfig(env.db).set('GOOGLE_CLOUD_PROJECT', 'project-one')
  openConfig(env.db).set('GOOGLE_CLOUD_LOCATION', 'europe-west1')
  const credentials = JSON.stringify({ type: 'service_account', private_key: 'vertex-secret' })
  openSecrets(env.db, 'bootstrap-secret').set('GOOGLE_VERTEX_CREDENTIALS_JSON', credentials)
  const previous = process.env.GOOGLE_APPLICATION_CREDENTIALS
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/host/ambient-adc.json'
  try {
    const { resolveProtectedProviderRuntime } = await import('../../src/lib/protected-provider.ts')
    const resolved = await resolveProtectedProviderRuntime(
      env.db,
      'bootstrap-secret',
      agent('google-vertex:gemini-3.6-flash'),
    )
    expect(resolved.runtime).toMatchObject({
      providerName: 'google-vertex',
      credentialFile: { envName: 'GOOGLE_APPLICATION_CREDENTIALS', content: credentials },
    })
    expect(resolved.runtime.credentialEnv).toEqual([
      { name: 'GOOGLE_CLOUD_PROJECT', value: 'project-one' },
      { name: 'GOOGLE_CLOUD_LOCATION', value: 'europe-west1' },
    ])
    expect(JSON.stringify(resolved.runtime)).not.toContain('/host/ambient-adc.json')
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previous
  }
})
