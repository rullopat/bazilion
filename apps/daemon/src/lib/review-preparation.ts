import type { AgentReview, ResolvedAgent } from '@bazilion/api-types'
import {
  type RestrictedReviewWorkerSpec,
  type ReviewWorkerProposal,
  spawnReviewWorker,
} from '../runtime/index.ts'
import { getCtx } from './ctx.ts'
import { resolveProtectedOpenAICodexRuntime } from './protected-provider.ts'
import {
  assertTrustedReviewInvocation,
  createTrustedReviewInvocation,
  type TrustedRestrictedReviewInvocation,
} from './turn-invocation.ts'

const preparedReviewBrand: unique symbol = Symbol('bazilion.prepared-restricted-review')
const preparedReviews = new WeakSet<object>()
const consumedReviews = new WeakSet<object>()

export interface PreparedRestrictedReview {
  readonly [preparedReviewBrand]: true
  readonly invocation: TrustedRestrictedReviewInvocation
  readonly spec: RestrictedReviewWorkerSpec
  readonly refreshApiKey: (providerName: string) => Promise<string>
}

export async function prepareRestrictedReview(input: {
  review: Pick<AgentReview, 'id' | 'agentId' | 'trigger'>
  agent: ResolvedAgent
  message: string
  evidence: Array<{ sessionId: string; entryOrdinal: number }>
}): Promise<PreparedRestrictedReview> {
  if (input.review.agentId !== input.agent.agent.id) {
    throw new Error('restricted review does not match the resolved Agent')
  }
  if (!input.message || input.message.length > 60_000 || input.evidence.length > 2_000) {
    throw new Error('restricted review input is outside its bounded contract')
  }
  const invocation: TrustedRestrictedReviewInvocation = createTrustedReviewInvocation({
    kind: 'restricted_review',
    authorization: {
      kind: 'none',
      reviewId: input.review.id,
      trigger: input.review.trigger,
    },
    bashApprovalMode: 'auto_deny',
  })
  assertTrustedReviewInvocation(invocation)
  const { db, authToken } = getCtx()
  const provider = await resolveProtectedOpenAICodexRuntime(
    db,
    authToken,
    input.agent,
    input.agent.reasoningLevel,
  )
  const prepared = {
    [preparedReviewBrand]: true as const,
    invocation,
    spec: {
      kind: 'restricted_review' as const,
      agentId: input.review.agentId,
      message: input.message,
      turnId: input.review.id,
      runtime: provider.runtime,
      review: { reviewId: input.review.id, evidence: input.evidence },
    },
    refreshApiKey: provider.refreshApiKey,
  }
  Object.defineProperty(prepared, preparedReviewBrand, { enumerable: false })
  deepFreezePreparedReview(prepared)
  preparedReviews.add(prepared)
  return prepared
}

export async function executePreparedReview(
  prepared: PreparedRestrictedReview,
  signal?: AbortSignal,
): Promise<ReviewWorkerProposal[]> {
  consumePreparedReview(prepared)
  return spawnReviewWorker(prepared.spec, {
    signal,
    apiKeyRefreshHost: { refresh: prepared.refreshApiKey },
  })
}

function assertPreparedReview(value: unknown): asserts value is PreparedRestrictedReview {
  if (
    typeof value !== 'object' ||
    value === null ||
    !preparedReviews.has(value) ||
    (value as Partial<PreparedRestrictedReview>)[preparedReviewBrand] !== true
  ) {
    throw new Error('restricted review was not prepared by the trusted daemon boundary')
  }
  assertTrustedReviewInvocation((value as PreparedRestrictedReview).invocation)
}

function consumePreparedReview(value: unknown): asserts value is PreparedRestrictedReview {
  assertPreparedReview(value)
  if (consumedReviews.has(value)) {
    throw new Error('prepared restricted review has already been executed')
  }
  consumedReviews.add(value)
}

function deepFreezePreparedReview(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) deepFreezePreparedReview(child, seen)
  Object.freeze(value)
}
