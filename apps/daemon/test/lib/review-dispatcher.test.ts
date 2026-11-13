import type { ProviderMessage } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { agentReviewRepo } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { cancelAgent } from '../../src/lib/agent-cancel.ts'
import { ExecutionUnavailableError } from '../../src/lib/execution-unavailable.ts'
import type { ReviewDigest } from '../../src/lib/review-digest.ts'
import { renderReviewInput } from '../../src/lib/review-dispatcher.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const mocks = vi.hoisted(() => ({
  context: null as TestEnv | null,
  resolveReviewProvider: vi.fn(),
  spawnReviewWorker: vi.fn(),
}))

vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => {
    if (!mocks.context) throw new Error('missing review-dispatcher test context')
    return { db: mocks.context.db, paths: mocks.context.paths, authToken: 'bootstrap-sentinel' }
  },
}))

vi.mock('../../src/lib/review-provider.ts', () => ({
  resolveReviewProvider: mocks.resolveReviewProvider,
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

const refreshApiKey = async () => 'rotated-access-token'
let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
  mocks.context = env
  mocks.resolveReviewProvider.mockReset()
  mocks.spawnReviewWorker.mockReset()
  mocks.resolveReviewProvider.mockResolvedValue({
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      apiKey: 'current-access-token',
    },
    refreshApiKey,
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

function digest(entries: ReviewDigest['entries']): ReviewDigest {
  return {
    sessionId: 'session-a',
    startOrdinal: entries[0]?.ordinal ?? 0,
    endOrdinal: entries.at(-1)?.ordinal ?? 0,
    inputCharacters: entries.reduce((total, entry) => total + entry.text.length, 0),
    turnsReviewed: 1,
    entries,
  }
}

describe('learning review dispatch', () => {
  test('the reviewer gets only the digest, its evidence and the review model credential', async () => {
    const { review } = enqueueReview()
    const proposals = [
      {
        scope: 'private' as const,
        text: 'A verified lesson',
        evidenceEntryIds: [{ sessionId: 'session-1', entryOrdinal: 1 }],
      },
    ]
    mocks.spawnReviewWorker.mockResolvedValue(proposals)
    const { dispatchAgentReview } = await import('../../src/lib/review-dispatcher.ts')
    await dispatchAgentReview(review.id)

    // The review runs on the Agent's review model and reasoning level.
    expect(mocks.resolveReviewProvider).toHaveBeenCalledWith(
      env.db,
      'bootstrap-sentinel',
      expect.objectContaining({ model: 'openai-codex:gpt-5.6-sol', reasoningLevel: 'low' }),
    )
    const [spec, options] = mocks.spawnReviewWorker.mock.calls[0] ?? []
    expect(Object.keys(spec).sort()).toEqual(['evidence', 'kind', 'message', 'runtime'])
    expect(spec).toMatchObject({
      kind: 'restricted_review',
      runtime: { providerName: 'openai-codex', apiKey: 'current-access-token' },
      evidence: [
        { sessionId: 'session-1', entryOrdinal: 0 },
        { sessionId: 'session-1', entryOrdinal: 1 },
      ],
    })
    expect(spec.message).toContain('[session-1:1] ASSISTANT: answer')
    expect(JSON.stringify(spec)).not.toMatch(
      /docker|workspace|memory|home|browser|mcp|refresh|bootstrap-sentinel/i,
    )
    expect(options).toMatchObject({ apiKeyRefreshHost: { refresh: refreshApiKey } })
    expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
      status: 'completed',
      proposalCount: 1,
    })
  })

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

  test('missing review provider credentials are recorded with their real reason', async () => {
    const { review } = enqueueReview()
    mocks.resolveReviewProvider.mockRejectedValue(
      new ExecutionUnavailableError('Selected provider credentials are unavailable.'),
    )
    const { dispatchAgentReview } = await import('../../src/lib/review-dispatcher.ts')
    await dispatchAgentReview(review.id)

    expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
      status: 'failed',
      lastError: 'Selected provider credentials are unavailable.',
    })
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

test('review input bounds every context section and evidence to rendered entries', () => {
  const prepared = renderReviewInput(
    digest([
      { sessionId: 'session-a', ordinal: 1, role: 'user', text: 'old'.repeat(20_000) },
      { sessionId: 'session-a', ordinal: 2, role: 'assistant', text: 'new evidence' },
    ]),
    ['private'.repeat(2_000), 'must-not-fit'],
    ['lessons/'.concat('x'.repeat(5_000)), 'must-not-fit'],
  )

  expect(prepared.message.length).toBeLessThan(55_000)
  expect(prepared.message).toContain('[session-a:2] ASSISTANT: new evidence')
  expect(prepared.evidence).toContainEqual({ sessionId: 'session-a', entryOrdinal: 2 })
  for (const item of prepared.evidence) {
    expect(prepared.message).toContain(`[${item.sessionId}:${item.entryOrdinal}]`)
  }
  expect(prepared.message).not.toContain('must-not-fit')
})

test('review input renders empty bounded context explicitly', () => {
  const prepared = renderReviewInput(digest([]), [], [])
  expect(prepared.message).toContain('# Transcript digest\n\n(none)')
  expect(prepared.message).toContain('# Existing private lessons\n(none)')
  expect(prepared.message).toContain('# Existing shared lesson keys\n(none)')
  expect(prepared.evidence).toEqual([])
})
