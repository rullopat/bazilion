import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { providerStateRepo } from '../../src/core/index.ts'
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

test('resolves only current Codex access, model, reasoning, and required refresher', async () => {
  const refreshApiKey = vi.fn(async () => 'fresh-token')
  resolveAgentApiKey.mockResolvedValue({ apiKey: 'current-token', refreshApiKey })
  providerStateRepo.setEnabled(env.db, 'openai-codex', true)
  const { resolveProtectedOpenAICodexRuntime } = await import('../../src/lib/protected-provider.ts')

  await expect(
    resolveProtectedOpenAICodexRuntime(env.db, 'bootstrap-secret', agent(), 'low'),
  ).resolves.toEqual({
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      accessToken: 'current-token',
    },
    refreshApiKey,
  })
})

test('fails closed for configured-only providers, disabled Codex, or missing refresh', async () => {
  const { resolveProtectedOpenAICodexRuntime } = await import('../../src/lib/protected-provider.ts')
  await expect(
    resolveProtectedOpenAICodexRuntime(env.db, 'bootstrap-secret', agent('anthropic:claude')),
  ).rejects.toThrow(/require an OpenAI Codex model/)

  await expect(
    resolveProtectedOpenAICodexRuntime(env.db, 'bootstrap-secret', agent()),
  ).rejects.toThrow(/not enabled/)

  providerStateRepo.setEnabled(env.db, 'openai-codex', true)
  resolveAgentApiKey.mockResolvedValue({ apiKey: 'current-token' })
  await expect(
    resolveProtectedOpenAICodexRuntime(env.db, 'bootstrap-secret', agent()),
  ).rejects.toThrow(/bound refresh/)
})
