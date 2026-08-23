import type { ProviderMessage } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { agentReviewRepo } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { cancelAgent } from '../../src/lib/agent-cancel.ts'
import { ProtectedExecutionUnavailableError } from '../../src/lib/protected-provider.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const mocks = vi.hoisted(() => ({
  context: null as TestEnv | null,
  resolveProtectedOpenAICodexRuntime: vi.fn(),
  spawnReviewWorker: vi.fn(),
}))

vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => {
    if (!mocks.context) throw new Error('missing review-dispatcher test context')
    return { db: mocks.context.db, paths: mocks.context.paths, authToken: 'bootstrap-sentinel' }
  },
}))

vi.mock('../../src/lib/protected-provider.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/protected-provider.ts')>()),
  resolveProtectedOpenAICodexRuntime: mocks.resolveProtectedOpenAICodexRuntime,
}))

vi.mock('../../src/runtime/index.ts', () => ({
  loadInitialMessages: () => [],
  loadSessionHead: () => ({ file: 'session-1.jsonl' }),
  piMessagesToProviderView: () =>
    [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ] satisfies ProviderMessage[],
  qmdBackend: () => ({
    init: async () => {},
    list: async () => [],
  }),
  spawnReviewWorker: mocks.spawnReviewWorker,
}))

let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
  mocks.context = env
  mocks.resolveProtectedOpenAICodexRuntime.mockReset()
  mocks.spawnReviewWorker.mockReset()
  mocks.resolveProtectedOpenAICodexRuntime.mockResolvedValue({
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      accessToken: 'current-access-token',
    },
    refreshApiKey: async () => 'rotated-access-token',
  })
  mocks.spawnReviewWorker.mockResolvedValue([])
})

afterEach(() => {
  mocks.context = null
  env.cleanup()
})

function enqueueReview() {
  createProfile(env.db, env.paths, {
    id: 'review-profile',
    defaultModel: 'openai-codex:gpt-5.6-sol',
  })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'review-profile',
    teamId: env.teamId,
  })
  env.db.raw.run(
    `UPDATE agents SET review_model = 'openai-codex:gpt-5.6-sol',
       review_reasoning_level = 'low' WHERE id = ?`,
    [agent.id],
  )
  return { agent, review: agentReviewRepo.enqueueManual(env.db, agent.id) }
}

describe('restricted review dispatch ownership', () => {
  test('missing or invalid Docker configuration does not block the reviewer-only surface', async () => {
    const previous = process.env.BAZILION_BASH_SANDBOX
    process.env.BAZILION_BASH_SANDBOX = 'invalid-docker-mode'
    try {
      const { review } = enqueueReview()
      const { dispatchAgentReview } = await import('../../src/lib/review-dispatcher.ts')
      await dispatchAgentReview(review.id)

      expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
        status: 'completed',
        proposalCount: 0,
      })
      expect(mocks.spawnReviewWorker).toHaveBeenCalledOnce()
    } finally {
      if (previous === undefined) delete process.env.BAZILION_BASH_SANDBOX
      else process.env.BAZILION_BASH_SANDBOX = previous
    }
  })

  test('missing protected provider refresh becomes a bounded source-owned failure', async () => {
    const { review } = enqueueReview()
    mocks.resolveProtectedOpenAICodexRuntime.mockRejectedValue(
      new ProtectedExecutionUnavailableError(
        'OpenAI Codex access and bound refresh are required for protected unattended turns.',
      ),
    )
    const { dispatchAgentReview } = await import('../../src/lib/review-dispatcher.ts')
    await dispatchAgentReview(review.id)

    const failed = agentReviewRepo.get(env.db, review.id)
    expect(failed).toMatchObject({
      status: 'retrying',
      lastError:
        'OpenAI Codex access and bound refresh are required for protected unattended turns.',
    })
    expect(failed?.lastError?.length).toBeLessThanOrEqual(500)
    expect(mocks.spawnReviewWorker).not.toHaveBeenCalled()
  })

  test('cancellation is recorded by the review owner instead of as a provider failure', async () => {
    const { agent, review } = enqueueReview()
    mocks.spawnReviewWorker.mockImplementation(async () => {
      expect(cancelAgent(agent.id)).toBe(true)
      throw new Error('provider error after cancellation')
    })
    const { dispatchAgentReview } = await import('../../src/lib/review-dispatcher.ts')
    await dispatchAgentReview(review.id)

    expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
      status: 'cancelled',
      lastError: 'cancelled',
    })
  })
})
