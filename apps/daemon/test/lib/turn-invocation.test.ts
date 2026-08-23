import type { Attachment } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import {
  assertTrustedReviewInvocation,
  assertTrustedTurnInvocation,
  createPreclaimedTurn,
  createTrustedReviewInvocation,
  createTrustedTurnInvocation,
  executionSurfaceForInvocation,
  invocationHasPreclaimedRegistration,
  invocationOwnsUserAuthorization,
  invocationRepresentsUserTurn,
  type TrustedTurnInvocation,
} from '../../src/lib/turn-invocation.ts'

const releaseLease = () => {}

function turn(agentId = 'agent-1', message = 'hello', attachments: Attachment[] = []) {
  return { agentId, message, attachments }
}

function claim(agentId: string, attemptId: string) {
  return createPreclaimedTurn({
    agentId,
    attemptId,
    controller: new AbortController(),
    releaseLease,
    registered: true,
  })
}

const invocations: Array<{
  invocation: TrustedTurnInvocation
  surface: 'configured_operator_http' | 'protected'
  authorizes: boolean
  preclaimed: boolean
  userTurn: boolean
}> = [
  {
    invocation: createTrustedTurnInvocation({
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: 'http-1',
        requester: 'user',
        agentId: 'agent-1',
      },
      turn: turn(),
      bashApprovalMode: 'interactive',
    }),
    surface: 'configured_operator_http',
    authorizes: true,
    preclaimed: false,
    userTurn: true,
  },
  {
    invocation: createTrustedTurnInvocation({
      kind: 'telegram',
      authorization: {
        origin: 'telegram_agent_topic',
        attemptKind: 'telegram_ingress',
        attemptId: '-42:7',
        approvalPayloadKind: 'telegram_ingress',
        approvalPayload: {
          agentId: 'agent-1',
          text: 'hello',
          media: null,
          chatId: -42,
          threadId: 4,
          messageId: 7,
        },
        requester: 'telegram:1',
      },
      turn: turn(),
      bashApprovalMode: 'auto_deny',
    }),
    surface: 'protected',
    authorizes: true,
    preclaimed: false,
    userTurn: true,
  },
  {
    invocation: createTrustedTurnInvocation({
      kind: 'scheduled_trigger',
      authorization: {
        origin: 'scheduler_trigger',
        attemptKind: 'scheduler_trigger',
        attemptId: 'trigger-1:1000',
        agentId: 'agent-1',
      },
      turn: turn(),
      claim: claim('agent-1', 'trigger-1:1000'),
      bashApprovalMode: 'auto_deny',
    }),
    surface: 'protected',
    authorizes: false,
    preclaimed: true,
    userTurn: false,
  },
  {
    invocation: createTrustedTurnInvocation({
      kind: 'inbox_wake',
      authorization: {
        origin: 'scheduler_inbox',
        attemptKind: 'inbox_wake',
        attemptId: 'agent-1:message-1',
        agentId: 'agent-1',
      },
      turn: { ...turn(), causalParentMessageId: 'message-1' },
      claim: claim('agent-1', 'agent-1:message-1'),
      bashApprovalMode: 'auto_deny',
    }),
    surface: 'protected',
    authorizes: false,
    preclaimed: true,
    userTurn: false,
  },
  {
    invocation: createTrustedTurnInvocation({
      kind: 'approval_delivery',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: 'http-2',
        approvalId: 'approval-1',
        agentId: 'agent-1',
      },
      turn: turn(),
      bashApprovalMode: 'auto_deny',
    }),
    surface: 'protected',
    authorizes: false,
    preclaimed: false,
    userTurn: true,
  },
]

test.each(
  invocations,
)('$invocation.kind derives one non-downgradable execution and authorization posture', ({
  invocation,
  surface,
  authorizes,
  preclaimed,
  userTurn,
}) => {
  expect(executionSurfaceForInvocation(invocation)).toBe(surface)
  expect(invocationOwnsUserAuthorization(invocation)).toBe(authorizes)
  expect(invocationHasPreclaimedRegistration(invocation)).toBe(preclaimed)
  expect(invocationRepresentsUserTurn(invocation)).toBe(userTurn)
  expect(() => assertTrustedTurnInvocation(invocation)).not.toThrow()
})

test('raw, cloned, contradictory, and downgrade-shaped metadata is never trusted', () => {
  const create = createTrustedTurnInvocation as (value: unknown) => TrustedTurnInvocation
  for (const value of [
    null,
    {},
    { kind: 'internal_turn' },
    {
      kind: 'operator_http',
      authorization: {
        origin: 'http_chat',
        attemptKind: 'http_chat_ingress',
        attemptId: 'http-1',
        requester: 'user',
        agentId: 'agent-1',
      },
      turn: turn(),
      bashApprovalMode: 'interactive',
      requireIsolation: false,
    },
  ]) {
    expect(() => create(value)).toThrow('invalid trusted turn invocation')
  }
  expect(() => assertTrustedTurnInvocation({ ...invocations[0]?.invocation })).toThrow(
    'invalid trusted turn invocation',
  )
})

test('preclaimed scheduler and inbox identity cannot be rebound to another target or attempt', () => {
  const create = createTrustedTurnInvocation as (value: unknown) => TrustedTurnInvocation
  const boundClaim = claim('agent-1', 'trigger-1:1000')
  const base = {
    kind: 'scheduled_trigger',
    authorization: {
      origin: 'scheduler_trigger',
      attemptKind: 'scheduler_trigger',
      attemptId: 'trigger-1:1000',
      agentId: 'agent-1',
    },
    turn: turn(),
    claim: boundClaim,
    bashApprovalMode: 'auto_deny',
  }
  expect(() => create({ ...base, turn: turn('agent-2') })).toThrow(/invalid trusted/)
  expect(() =>
    create({
      ...base,
      authorization: { ...base.authorization, attemptId: 'trigger-2:2000' },
    }),
  ).toThrow(/invalid trusted/)
  expect(() => create({ ...base, claim: { ...boundClaim } })).toThrow(/invalid trusted/)
})

test('the factory snapshots and freezes the exact message, attachments, and causal parent', () => {
  const attachments: Attachment[] = [{ name: 'a.txt', mimeType: 'text/plain', data: 'YQ==' }]
  const invocation = createTrustedTurnInvocation({
    kind: 'operator_http',
    authorization: {
      origin: 'http_chat',
      attemptKind: 'http_chat_ingress',
      attemptId: 'http-frozen',
      requester: 'user',
      agentId: 'agent-1',
    },
    turn: { ...turn('agent-1', 'exact', attachments), causalParentMessageId: null },
    bashApprovalMode: 'auto_deny',
  })
  attachments[0] = { mimeType: 'application/secret', data: 'secret' }
  expect(invocation.turn).toEqual({
    agentId: 'agent-1',
    message: 'exact',
    attachments: [{ name: 'a.txt', mimeType: 'text/plain', data: 'YQ==' }],
    causalParentMessageId: null,
  })
  expect(Object.isFrozen(invocation)).toBe(true)
  expect(Object.isFrozen(invocation.turn)).toBe(true)
  expect(Object.isFrozen(invocation.turn.attachments[0])).toBe(true)
})

test.each([
  'web',
  'tty_cli',
  'piped_cli',
  'mobile',
])('%s reaches the same configured operator HTTP policy', (client) => {
  const invocation = createTrustedTurnInvocation({
    kind: 'operator_http',
    authorization: {
      origin: 'http_chat',
      attemptKind: 'http_chat_ingress',
      attemptId: `${client}-1`,
      requester: 'user',
      agentId: 'agent-1',
    },
    turn: turn(),
    bashApprovalMode: client === 'web' || client === 'tty_cli' ? 'interactive' : 'auto_deny',
  })
  expect(executionSurfaceForInvocation(invocation)).toBe('configured_operator_http')
})

test.each([
  'manual',
  'cadence',
] as const)('%s reviews use the same nominal restricted-review policy', (trigger) => {
  const invocation = createTrustedReviewInvocation({
    kind: 'restricted_review',
    authorization: { kind: 'none', reviewId: `review-${trigger}`, trigger },
    bashApprovalMode: 'auto_deny',
  })
  expect(() => assertTrustedReviewInvocation(invocation)).not.toThrow()
  expect(() => assertTrustedReviewInvocation({ ...invocation })).toThrow(
    'invalid trusted turn invocation',
  )
})
