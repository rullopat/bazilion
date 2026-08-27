import type { ResolvedAgent } from '@bazilion/api-types'
import { beforeEach, expect, test, vi } from 'vitest'

const { spawnReviewWorker, resolveProtectedProviderRuntime } = vi.hoisted(() => ({
  spawnReviewWorker: vi.fn(),
  resolveProtectedProviderRuntime: vi.fn(),
}))

vi.mock('../../src/runtime/index.ts', () => ({ spawnReviewWorker }))
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: { test: true }, authToken: 'daemon-only-bootstrap' }),
}))
vi.mock('../../src/lib/protected-provider.ts', () => ({
  resolveProtectedProviderRuntime,
}))

import {
  executePreparedReview,
  type PreparedRestrictedReview,
  prepareRestrictedReview,
} from '../../src/lib/review-preparation.ts'

const refreshApiKey = vi.fn(async () => 'rotated-access')

function agent(): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Reviewer',
      modelOverride: 'openai-codex:gpt-5.6-sol',
      reasoningLevel: 'xhigh',
      reviewEnabled: true,
      reviewEveryNTurns: 8,
      reviewModel: 'openai-codex:gpt-5.6-sol',
      reviewReasoningLevel: 'low',
      reviewTurnsSinceLast: 0,
      status: 'idle',
      dir: '/srv/bazilion/agents/agent-1',
      teamId: 'team-1',
      telegramTopicId: null,
      telegramMirrorMode: 'minimal',
      telegramIconEmoji: null,
      createdAt: 0,
      archivedAt: null,
    },
    profile: {
      id: 'profile-1',
      name: 'Profile',
      dir: '/srv/bazilion/profiles/profile-1',
      defaultModel: 'openai-codex:gpt-5.6-sol',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.6-sol',
    reasoningLevel: 'low',
    team: {
      id: 'team-1',
      name: 'Team',
      path: '/srv/bazilion/teams/team-1',
      userMd: '',
      telegramTopicNameFormat: null,
      createdAt: 0,
    },
    skills: [],
    privateLessons: [],
  }
}

beforeEach(() => {
  spawnReviewWorker.mockReset()
  resolveProtectedProviderRuntime.mockReset()
  refreshApiKey.mockClear()
  resolveProtectedProviderRuntime.mockResolvedValue({
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      apiKey: 'current-access',
    },
    refreshApiKey,
  })
})

test.each([
  'manual',
  'cadence',
] as const)('%s review prepares and executes the same closed reviewer-only surface', async (trigger) => {
  const prepared = await prepareRestrictedReview({
    review: { id: `review-${trigger}`, agentId: 'agent-1', trigger },
    agent: agent(),
    message: '# bounded digest',
    evidence: [{ sessionId: 'session-1', entryOrdinal: 4 }],
  })

  expect(resolveProtectedProviderRuntime).toHaveBeenCalledWith(
    { test: true },
    'daemon-only-bootstrap',
    expect.objectContaining({ model: 'openai-codex:gpt-5.6-sol' }),
    'low',
  )
  expect(Object.keys(prepared.spec).sort()).toEqual(
    ['agentId', 'kind', 'message', 'review', 'runtime', 'turnId'].sort(),
  )
  expect(prepared.spec).toEqual({
    kind: 'restricted_review',
    agentId: 'agent-1',
    message: '# bounded digest',
    turnId: `review-${trigger}`,
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'low',
      apiKey: 'current-access',
    },
    review: {
      reviewId: `review-${trigger}`,
      evidence: [{ sessionId: 'session-1', entryOrdinal: 4 }],
    },
  })
  expect(JSON.stringify(prepared.spec)).not.toMatch(
    /docker|workspace|memory|home|browser|mcp|messageHost|refresh|daemon-only-bootstrap/i,
  )

  const proposals = [
    {
      scope: 'private' as const,
      text: 'A verified lesson',
      evidenceEntryIds: [{ sessionId: 'session-1', entryOrdinal: 4 }],
    },
  ]
  spawnReviewWorker.mockResolvedValue(proposals)
  await expect(executePreparedReview(prepared)).resolves.toEqual(proposals)
  expect(spawnReviewWorker).toHaveBeenCalledWith(prepared.spec, {
    signal: undefined,
    apiKeyRefreshHost: { refresh: refreshApiKey },
  })
})

test('review preparation fails before provider resolution for mismatched or unbounded input', async () => {
  await expect(
    prepareRestrictedReview({
      review: { id: 'review-1', agentId: 'other-agent', trigger: 'manual' },
      agent: agent(),
      message: 'digest',
      evidence: [],
    }),
  ).rejects.toThrow(/does not match/)
  await expect(
    prepareRestrictedReview({
      review: { id: 'review-2', agentId: 'agent-1', trigger: 'cadence' },
      agent: agent(),
      message: 'x'.repeat(60_001),
      evidence: [],
    }),
  ).rejects.toThrow(/bounded contract/)
  expect(resolveProtectedProviderRuntime).not.toHaveBeenCalled()
})

test('raw review execution rejects a forged unprepared specification', async () => {
  await expect(
    executePreparedReview({
      spec: { kind: 'restricted_review' },
      refreshApiKey,
    } as unknown as PreparedRestrictedReview),
  ).rejects.toThrow(/not prepared by the trusted daemon boundary/)
  expect(spawnReviewWorker).not.toHaveBeenCalled()
})

test('prepared review is immutable, clone-resistant, and executable exactly once', async () => {
  const prepared = await prepareRestrictedReview({
    review: { id: 'review-once', agentId: 'agent-1', trigger: 'manual' },
    agent: agent(),
    message: '# bounded digest',
    evidence: [{ sessionId: 'session-1', entryOrdinal: 4 }],
  })
  expect(Object.isFrozen(prepared)).toBe(true)
  expect(Object.isFrozen(prepared.spec)).toBe(true)
  expect(Object.isFrozen(prepared.spec.runtime)).toBe(true)
  expect(Object.isFrozen(prepared.spec.review.evidence)).toBe(true)
  expect(Reflect.set(prepared.spec.runtime, 'apiKey', 'MUTATED')).toBe(false)
  expect(prepared.spec.runtime.apiKey).toBe('current-access')

  await expect(executePreparedReview({ ...prepared })).rejects.toThrow(
    /not prepared by the trusted daemon boundary/,
  )
  spawnReviewWorker.mockResolvedValue([])
  await expect(executePreparedReview(prepared)).resolves.toEqual([])
  await expect(executePreparedReview(prepared)).rejects.toThrow(/already been executed/)
  expect(spawnReviewWorker).toHaveBeenCalledOnce()
})
