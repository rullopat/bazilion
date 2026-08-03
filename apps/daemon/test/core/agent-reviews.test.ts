import { afterEach, beforeEach, expect, test } from 'vitest'
import * as agentLessonProposalRepo from '../../src/core/repos/agentLessonProposals.ts'
import * as agentReviewRepo from '../../src/core/repos/agentReviews.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as profileRepo from '../../src/core/repos/profiles.ts'
import { makeTestEnv, type TestEnv } from './helpers.ts'

let env: TestEnv

beforeEach(() => {
  env = makeTestEnv()
  profileRepo.insert(env.db, {
    id: 'p',
    name: 'p',
    dir: env.paths.profileDir('p'),
    defaultModel: 'lmstudio:x',
    skillsMode: 'selected',
  })
  agentRepo.insert(env.db, {
    id: 'a1',
    profileId: 'p',
    name: 'A',
    modelOverride: null,
    reasoningLevel: 'medium',
    status: 'idle',
    dir: env.paths.agentDir('a1'),
    teamId: env.teamId,
  })
})

afterEach(() => env.cleanup())

test('reviews are disabled by default and cadence enqueue is atomic', () => {
  expect(agentReviewRepo.recordSuccessfulUserTurn(env.db, 'a1', 1_000)).toBeNull()
  expect(agentRepo.get(env.db, 'a1')).toMatchObject({
    reviewEnabled: false,
    reviewTurnsSinceLast: 0,
  })
  agentRepo.setReviewConfig(env.db, 'a1', {
    enabled: true,
    everyNTurns: 2,
    model: null,
    reasoningLevel: 'low',
  })
  expect(agentReviewRepo.recordSuccessfulUserTurn(env.db, 'a1', 2_000)).toBeNull()
  const due = agentReviewRepo.recordSuccessfulUserTurn(env.db, 'a1', 3_000)
  expect(due).toMatchObject({ trigger: 'cadence', status: 'pending' })
  expect(agentRepo.get(env.db, 'a1')?.reviewTurnsSinceLast).toBe(0)
  expect(agentReviewRepo.enqueueManual(env.db, 'a1', 4_000).id).toBe(due?.id)
})

test('claim is exclusive and expired leases recover with bounded failure', () => {
  const review = agentReviewRepo.enqueueManual(env.db, 'a1', 1_000)
  expect(agentReviewRepo.claim(env.db, review.id, { now: 1_000, leaseMs: 100 })).toMatchObject({
    status: 'running',
    attemptCount: 1,
  })
  expect(agentReviewRepo.claim(env.db, review.id, { now: 1_050 })).toBeNull()
  expect(agentReviewRepo.claim(env.db, review.id, { now: 1_101 })).toMatchObject({
    attemptCount: 2,
  })
  agentReviewRepo.fail(env.db, review.id, 'temporary', {
    now: 1_200,
    maxAttempts: 3,
    retryDelayMs: 10,
  })
  expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
    status: 'retrying',
    nextAttemptAt: 1_220,
  })
})

test('source diagnostics and errors are bounded without transcript copies', () => {
  const review = agentReviewRepo.enqueueManual(env.db, 'a1', 1_000)
  agentReviewRepo.claim(env.db, review.id, { now: 1_000 })
  agentReviewRepo.setSource(env.db, review.id, {
    sessionId: 'session-a',
    startOrdinal: 4,
    endOrdinal: 12,
    inputCharacters: 1234,
    turnsReviewed: 4,
  })
  agentReviewRepo.fail(env.db, review.id, 'x'.repeat(3_000), { now: 2_000, maxAttempts: 1 })
  expect(agentReviewRepo.get(env.db, review.id)).toMatchObject({
    status: 'failed',
    sourceSessionId: 'session-a',
    sourceStartOrdinal: 4,
    sourceEndOrdinal: 12,
    inputCharacters: 1234,
    turnsReviewed: 4,
  })
  expect(agentReviewRepo.get(env.db, review.id)?.lastError).toHaveLength(2_000)
})

test('proposal rows preserve typed evidence without copying transcript text', () => {
  const review = agentReviewRepo.enqueueManual(env.db, 'a1', 1_000)
  const proposal = agentLessonProposalRepo.insert(env.db, {
    reviewId: review.id,
    agentId: 'a1',
    scope: 'private',
    text: 'Verify the result before reporting completion.',
    evidence: [{ sessionId: 'session-a', entryOrdinal: 7 }],
    now: 2_000,
  })
  expect(proposal).toMatchObject({
    status: 'pending',
    version: 1,
    evidence: [{ sessionId: 'session-a', entryOrdinal: 7 }],
  })
  expect(agentLessonProposalRepo.listForReview(env.db, review.id)).toEqual([proposal])
})
