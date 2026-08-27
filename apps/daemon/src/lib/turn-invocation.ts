import type { Attachment, BashApprovalMode } from '@bazilion/api-types'
import {
  isTelegramIngressAttempt,
  isTelegramIngressTurnBinding,
  type TelegramIngressAttempt,
} from './telegram/ingress-attempt.ts'

const trustedTurnBrand: unique symbol = Symbol('bazilion.trusted-turn-invocation')
const trustedReviewBrand: unique symbol = Symbol('bazilion.trusted-review-invocation')
const preclaimedTurnBrand: unique symbol = Symbol('bazilion.preclaimed-turn')
const trustedTurns = new WeakSet<object>()
const trustedReviews = new WeakSet<object>()
const trustedClaims = new WeakSet<object>()
const consumedClaims = new WeakSet<object>()

export interface PreclaimedTurn {
  readonly [preclaimedTurnBrand]: true
  agentId: string
  attemptId: string
  controller: AbortController
  releaseLease: () => void
  registered: true
}

export interface BoundAgentTurn {
  agentId: string
  message: string
  attachments: readonly Attachment[]
  causalParentMessageId?: string | null
}

export interface HttpIngressAttempt {
  origin: 'http_chat'
  attemptKind: 'http_chat_ingress'
  attemptId: string
  requester: 'user'
  agentId: string
}

export interface ScheduledTriggerAttempt {
  origin: 'scheduler_trigger'
  attemptKind: 'scheduler_trigger'
  attemptId: string
  agentId: string
}

export interface InboxWakeAttempt {
  origin: 'scheduler_inbox'
  attemptKind: 'inbox_wake'
  attemptId: string
  agentId: string
}

export type ApprovedUserTurnAttempt =
  | {
      origin: 'http_chat'
      attemptKind: 'http_chat_ingress'
      attemptId: string
      approvalId: string
      agentId: string
    }
  | {
      origin: 'telegram_agent_topic'
      attemptKind: 'telegram_ingress'
      attemptId: string
      approvalId: string
      agentId: string
    }

type TrustedTurnInvocationVariant =
  | {
      kind: 'operator_http'
      authorization: HttpIngressAttempt
      turn: BoundAgentTurn
      bashApprovalMode: BashApprovalMode
    }
  | {
      kind: 'telegram'
      authorization: TelegramIngressAttempt
      turn: BoundAgentTurn
      bashApprovalMode: 'auto_deny'
    }
  | {
      kind: 'scheduled_trigger'
      authorization: ScheduledTriggerAttempt
      turn: BoundAgentTurn
      claim: PreclaimedTurn
      bashApprovalMode: 'auto_deny'
    }
  | {
      kind: 'inbox_wake'
      authorization: InboxWakeAttempt
      turn: BoundAgentTurn
      claim: PreclaimedTurn
      bashApprovalMode: 'auto_deny'
    }
  | {
      kind: 'approval_delivery'
      authorization: ApprovedUserTurnAttempt
      turn: BoundAgentTurn
      bashApprovalMode: 'auto_deny'
    }

export type TrustedTurnInvocationInput = TrustedTurnInvocationVariant

/**
 * Trusted daemon-owned origin and exact payload for a normal Agent turn.
 * Capability posture, target Agent, message, attachments, and causal parent
 * are one immutable nominal value rather than independently supplied flags.
 */
export type TrustedTurnInvocation = TrustedTurnInvocationVariant & {
  readonly [trustedTurnBrand]: true
}

type TrustedRestrictedReviewInvocationInput = {
  kind: 'restricted_review'
  authorization: {
    kind: 'none'
    reviewId: string
    trigger: 'manual' | 'cadence'
  }
  bashApprovalMode: 'auto_deny'
}

export type TrustedRestrictedReviewInvocation = TrustedRestrictedReviewInvocationInput & {
  readonly [trustedReviewBrand]: true
}

export type TrustedInvocation = TrustedTurnInvocation | TrustedRestrictedReviewInvocation
export type TurnExecutionSurface = 'configured_operator_http' | 'protected'

export function createPreclaimedTurn(input: {
  agentId: string
  attemptId: string
  controller: AbortController
  releaseLease: () => void
  registered: true
}): PreclaimedTurn {
  if (
    !isNonEmptyString(input.agentId) ||
    !isNonEmptyString(input.attemptId) ||
    !(input.controller instanceof AbortController) ||
    typeof input.releaseLease !== 'function' ||
    input.registered !== true
  ) {
    throw invalidInvocation()
  }
  const claim = { ...input } as PreclaimedTurn
  Object.defineProperty(claim, preclaimedTurnBrand, { value: true })
  trustedClaims.add(claim)
  return Object.freeze(claim)
}

export function createTrustedTurnInvocation(
  value: TrustedTurnInvocationInput,
): TrustedTurnInvocation {
  validateTurnInvocation(value)
  const candidate = {
    ...value,
    authorization: cloneAuthorization(value),
    turn: cloneBoundTurn(value.turn),
  } as TrustedTurnInvocation
  validateTurnInvocation(candidate)
  Object.defineProperty(candidate, trustedTurnBrand, { value: true })
  trustedTurns.add(candidate)
  return Object.freeze(candidate)
}

export function createTrustedReviewInvocation(
  value: TrustedRestrictedReviewInvocationInput,
): TrustedRestrictedReviewInvocation {
  validateReviewInvocation(value)
  const candidate = {
    ...value,
    authorization: Object.freeze({ ...value.authorization }),
  } as TrustedRestrictedReviewInvocation
  validateReviewInvocation(candidate)
  Object.defineProperty(candidate, trustedReviewBrand, { value: true })
  trustedReviews.add(candidate)
  return Object.freeze(candidate)
}

export function executionSurfaceForInvocation(
  invocation: TrustedTurnInvocation,
): TurnExecutionSurface {
  return invocation.kind === 'operator_http' && !process.env.BAZILION_PUBLIC_ORIGIN
    ? 'configured_operator_http'
    : 'protected'
}

export function invocationOwnsUserAuthorization(
  invocation: TrustedTurnInvocation,
): invocation is Extract<TrustedTurnInvocation, { kind: 'operator_http' | 'telegram' }> {
  return invocation.kind === 'operator_http' || invocation.kind === 'telegram'
}

export function invocationHasPreclaimedRegistration(
  invocation: TrustedTurnInvocation,
): invocation is Extract<TrustedTurnInvocation, { kind: 'scheduled_trigger' | 'inbox_wake' }> {
  return invocation.kind === 'scheduled_trigger' || invocation.kind === 'inbox_wake'
}

/** Consume a scheduler/inbox lifecycle claim exactly once at preparation handoff. */
export function consumePreclaimedTurn(
  invocation: Extract<TrustedTurnInvocation, { kind: 'scheduled_trigger' | 'inbox_wake' }>,
): PreclaimedTurn {
  assertTrustedTurnInvocation(invocation)
  const claim = invocation.claim
  if (consumedClaims.has(claim)) {
    throw new Error('preclaimed Agent turn has already been prepared')
  }
  consumedClaims.add(claim)
  return claim
}

export function invocationRepresentsUserTurn(invocation: TrustedTurnInvocation): boolean {
  return (
    invocation.kind === 'operator_http' ||
    invocation.kind === 'telegram' ||
    invocation.kind === 'approval_delivery'
  )
}

export function assertTrustedTurnInvocation(
  value: unknown,
): asserts value is TrustedTurnInvocation {
  if (!isRecord(value) || !trustedTurns.has(value)) throw invalidInvocation()
  validateTurnInvocation(value)
}

export function assertTrustedReviewInvocation(
  value: unknown,
): asserts value is TrustedRestrictedReviewInvocation {
  if (!isRecord(value) || !trustedReviews.has(value)) throw invalidInvocation()
  validateReviewInvocation(value)
}

function validateTurnInvocation(value: unknown): asserts value is TrustedTurnInvocationInput {
  if (!isRecord(value) || typeof value.kind !== 'string') throw invalidInvocation()
  if (!isBoundAgentTurn(value.turn)) throw invalidInvocation()
  const turn = value.turn
  if (value.kind === 'operator_http') {
    assertExactKeys(value, ['kind', 'authorization', 'turn', 'bashApprovalMode'])
    if (!isRecord(value.authorization)) throw invalidInvocation()
    assertExactKeys(value.authorization, [
      'origin',
      'attemptKind',
      'attemptId',
      'requester',
      'agentId',
    ])
    if (
      (value.bashApprovalMode !== 'interactive' && value.bashApprovalMode !== 'auto_deny') ||
      !isAttempt(value.authorization, 'http_chat', 'http_chat_ingress') ||
      value.authorization.requester !== 'user' ||
      value.authorization.agentId !== turn.agentId
    ) {
      throw invalidInvocation()
    }
    return
  }
  if (value.kind === 'telegram') {
    assertExactKeys(value, ['kind', 'authorization', 'turn', 'bashApprovalMode'])
    if (!isRecord(value.authorization)) throw invalidInvocation()
    assertExactKeys(value.authorization, [
      'origin',
      'attemptKind',
      'attemptId',
      'approvalPayloadKind',
      'approvalPayload',
      'requester',
    ])
    if (
      value.bashApprovalMode !== 'auto_deny' ||
      !isTelegramIngressAttempt(value.authorization, turn.agentId) ||
      !isTelegramIngressTurnBinding(value.authorization, turn)
    ) {
      throw invalidInvocation()
    }
    return
  }
  if (value.kind === 'scheduled_trigger' || value.kind === 'inbox_wake') {
    assertExactKeys(value, ['kind', 'authorization', 'turn', 'claim', 'bashApprovalMode'])
    if (!isRecord(value.authorization) || !isRecord(value.claim)) throw invalidInvocation()
    assertExactKeys(value.authorization, ['origin', 'attemptKind', 'attemptId', 'agentId'])
    assertExactKeys(value.claim, [
      'agentId',
      'attemptId',
      'controller',
      'releaseLease',
      'registered',
    ])
    const expected =
      value.kind === 'scheduled_trigger'
        ? (['scheduler_trigger', 'scheduler_trigger'] as const)
        : (['scheduler_inbox', 'inbox_wake'] as const)
    if (
      value.bashApprovalMode !== 'auto_deny' ||
      !isAttempt(value.authorization, expected[0], expected[1]) ||
      value.authorization.agentId !== turn.agentId ||
      !isPreclaimedTurn(value.claim) ||
      value.claim.agentId !== turn.agentId ||
      value.claim.attemptId !== value.authorization.attemptId
    ) {
      throw invalidInvocation()
    }
    return
  }
  if (value.kind === 'approval_delivery') {
    assertExactKeys(value, ['kind', 'authorization', 'turn', 'bashApprovalMode'])
    if (value.bashApprovalMode !== 'auto_deny' || !isRecord(value.authorization)) {
      throw invalidInvocation()
    }
    const authorization = value.authorization
    assertExactKeys(authorization, ['origin', 'attemptKind', 'attemptId', 'approvalId', 'agentId'])
    const validOriginal =
      isAttempt(authorization, 'http_chat', 'http_chat_ingress') ||
      isAttempt(authorization, 'telegram_agent_topic', 'telegram_ingress')
    if (
      !validOriginal ||
      !isNonEmptyString(authorization.approvalId) ||
      authorization.agentId !== turn.agentId
    ) {
      throw invalidInvocation()
    }
    return
  }
  throw invalidInvocation()
}

function validateReviewInvocation(
  value: unknown,
): asserts value is TrustedRestrictedReviewInvocationInput {
  if (!isRecord(value)) throw invalidInvocation()
  assertExactKeys(value, ['kind', 'authorization', 'bashApprovalMode'])
  if (
    value.kind !== 'restricted_review' ||
    value.bashApprovalMode !== 'auto_deny' ||
    !isRecord(value.authorization)
  ) {
    throw invalidInvocation()
  }
  assertExactKeys(value.authorization, ['kind', 'reviewId', 'trigger'])
  if (
    value.authorization.kind !== 'none' ||
    !isNonEmptyString(value.authorization.reviewId) ||
    (value.authorization.trigger !== 'manual' && value.authorization.trigger !== 'cadence')
  ) {
    throw invalidInvocation()
  }
}

function cloneAuthorization(
  value: TrustedTurnInvocationInput,
): TrustedTurnInvocationInput['authorization'] {
  if (value.kind !== 'telegram') return Object.freeze({ ...value.authorization })
  const payload = value.authorization.approvalPayload
  return Object.freeze({
    ...value.authorization,
    approvalPayload: Object.freeze({
      ...payload,
      media: payload.media ? Object.freeze({ ...payload.media }) : null,
    }),
  })
}

function cloneBoundTurn(value: BoundAgentTurn): BoundAgentTurn {
  const attachments = value.attachments.map((attachment) => Object.freeze({ ...attachment }))
  return Object.freeze({
    agentId: value.agentId,
    message: value.message,
    attachments: Object.freeze(attachments),
    ...(value.causalParentMessageId !== undefined
      ? { causalParentMessageId: value.causalParentMessageId }
      : {}),
  })
}

function isBoundAgentTurn(value: unknown): value is BoundAgentTurn {
  if (!isRecord(value)) return false
  const expected = ['agentId', 'message', 'attachments']
  if ('causalParentMessageId' in value) expected.push('causalParentMessageId')
  assertExactKeys(value, expected)
  return (
    isNonEmptyString(value.agentId) &&
    typeof value.message === 'string' &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAttachment) &&
    (value.causalParentMessageId === undefined ||
      value.causalParentMessageId === null ||
      isNonEmptyString(value.causalParentMessageId))
  )
}

function isAttachment(value: unknown): value is Attachment {
  if (!isRecord(value)) return false
  const expected = ['mimeType', 'data']
  if ('name' in value) expected.push('name')
  assertExactKeys(value, expected)
  return (
    isNonEmptyString(value.mimeType) &&
    typeof value.data === 'string' &&
    (value.name === undefined || typeof value.name === 'string')
  )
}

function isPreclaimedTurn(value: unknown): value is PreclaimedTurn {
  return (
    isRecord(value) &&
    trustedClaims.has(value) &&
    isNonEmptyString(value.agentId) &&
    isNonEmptyString(value.attemptId) &&
    value.registered === true &&
    typeof value.releaseLease === 'function' &&
    value.controller instanceof AbortController
  )
}

function isAttempt(value: unknown, origin: string, attemptKind: string): boolean {
  return (
    isRecord(value) &&
    value.origin === origin &&
    value.attemptKind === attemptKind &&
    isNonEmptyString(value.attemptId)
  )
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const allowed = [...expected].sort()
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw invalidInvocation()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function invalidInvocation(): Error {
  return new Error('invalid trusted turn invocation')
}
