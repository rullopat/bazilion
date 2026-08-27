import type { CommunicationApprovalDetail, Message } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import {
  ApprovalDeliveryValidationError,
  planApprovalDelivery,
} from '../../src/lib/approval-delivery-plan.ts'

function approval(
  overrides: Partial<CommunicationApprovalDetail> = {},
): CommunicationApprovalDetail {
  return {
    id: 'approval-1',
    attemptKind: 'http_chat_ingress',
    attemptId: 'attempt-1',
    operation: 'user_to_agent',
    source: { kind: 'user', teamId: 'team-1' },
    target: { kind: 'agent', id: 'agent-1' },
    sourceTeamId: 'team-1',
    targetTeamId: 'team-1',
    channel: 'user',
    origin: 'http_chat',
    requester: 'user',
    policyRefs: [{ teamId: 'team-1', revision: 1 }],
    requiredEdgeIds: ['user::agent:agent-1'],
    payloadKind: 'agent_turn',
    status: 'pending',
    expiresAt: Date.now() + 10_000,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    deliveryError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: {
      agentId: 'agent-1',
      message: 'hello',
      attachments: [],
    },
    events: [],
    ...overrides,
  }
}

const inboxMessage: Message = {
  id: 'message-1',
  fromAgentId: 'agent-1',
  toAgentId: 'agent-2',
  replyTo: null,
  causalChainId: 'message-1',
  causalHop: 0,
  payload: '{"text":"hello"}',
  createdAt: Date.now(),
  readAt: null,
}

const context = {
  messageById: (id: string) => (id === inboxMessage.id ? inboxMessage : null),
}

describe('approval delivery planning', () => {
  test.each([
    {
      name: 'HTTP Agent turn',
      expected: 'agent_turn',
      detail: approval(),
    },
    {
      name: 'Telegram ingress',
      expected: 'telegram_ingress',
      detail: approval({
        attemptKind: 'telegram_ingress',
        attemptId: '-100:5',
        origin: 'telegram_agent_topic',
        payloadKind: 'telegram_ingress',
        payload: {
          agentId: 'agent-1',
          text: 'caption',
          media: null,
          chatId: -100,
          threadId: 42,
          messageId: 5,
        },
      }),
    },
    {
      name: 'scheduled trigger grant',
      expected: 'scheduler_trigger',
      detail: approval({
        attemptKind: 'scheduler_trigger',
        attemptId: 'trigger-1:123',
        operation: 'scheduler_trigger',
        origin: 'scheduler_trigger',
        payloadKind: 'scheduler_trigger',
        payload: {
          dispatchId: 'dispatch-1',
          triggerId: 'trigger-1',
          occurrence: 123,
          agentId: 'agent-1',
          message: 'scheduled work',
        },
      }),
    },
    ...(['agent_inbox', 'scheduler_inbox'] as const).map((origin) => ({
      name: `${origin} grant`,
      expected: 'inbox_message',
      detail: approval({
        attemptKind: 'inbox',
        attemptId: 'message-1',
        operation: 'deliver_agent_message',
        source: { kind: 'agent', id: 'agent-1' },
        target: { kind: 'agent', id: 'agent-2' },
        channel: 'same_team',
        origin,
        payloadKind: 'inbox_message',
        payload: { messageId: 'message-1' },
      }),
    })),
    ...(['agent_tool', 'http_agent_message'] as const).map((origin) => ({
      name: `${origin} Agent message`,
      expected: 'agent_message',
      detail: approval({
        attemptKind: origin,
        operation: 'send_agent_message',
        source: { kind: 'agent', id: 'agent-1' },
        target: { kind: 'agent', id: 'agent-2' },
        channel: 'same_team',
        origin,
        payloadKind: 'agent_message',
        payload: {
          from: 'agent-1',
          to: 'agent-2',
          payload: '{"text":"hello"}',
          replyTo: null,
          causalParentMessageId: null,
        },
      }),
    })),
    {
      name: 'HTTP chat frame',
      expected: 'http_chat_frame',
      detail: approval({
        attemptKind: 'http_chat_frame',
        operation: 'agent_to_user',
        source: { kind: 'agent', id: 'agent-1' },
        target: { kind: 'user', teamId: 'team-1' },
        origin: 'http_chat',
        payloadKind: 'http_chat_frame',
        payload: {
          agentId: 'agent-1',
          frame: { kind: 'event', event: { type: 'assistant_message', text: 'hello' } },
        },
      }),
    },
    ...(['telegram_text', 'telegram_typing', 'telegram_image', 'telegram_file'] as const).map(
      (payloadKind) => ({
        name: payloadKind,
        expected: payloadKind,
        detail: approval({
          attemptKind: 'telegram_egress',
          operation: 'agent_to_user',
          source: { kind: 'agent', id: 'agent-1' },
          target: { kind: 'user', teamId: 'team-1' },
          origin: 'telegram_mirror',
          payloadKind,
          payload:
            payloadKind === 'telegram_text'
              ? { chatId: -100, topicId: 42, text: 'hello', parseMode: null }
              : payloadKind === 'telegram_typing'
                ? { chatId: -100, topicId: 42 }
                : payloadKind === 'telegram_image'
                  ? { chatId: -100, topicId: 42, data: 'aW1hZ2U=', mimeType: 'image/png' }
                  : {
                      chatId: -100,
                      topicId: 42,
                      data: 'ZmlsZQ==',
                      mimeType: 'text/plain',
                      name: 'file.txt',
                    },
        }),
      }),
    ),
  ])('accepts the exact $name tuple', ({ detail, expected }) => {
    expect(planApprovalDelivery(detail, context).kind).toBe(expected)
  })

  test.each([
    ['unknown payload kind', { payloadKind: 'telegram_video' }],
    ['crossed origin', { origin: 'telegram_mirror' }],
    ['wrong attempt kind', { attemptKind: 'turn' }],
    ['wrong target', { target: { kind: 'agent', id: 'agent-2' } }],
    ['untyped attachments', { payload: { agentId: 'agent-1', message: 'x', attachments: [{}] } }],
  ] satisfies Array<
    [string, Partial<CommunicationApprovalDetail>]
  >)('rejects $0 before delivery', (_name, overrides) => {
    expect(() => planApprovalDelivery(approval(overrides), context)).toThrow(
      ApprovalDeliveryValidationError,
    )
  })

  test('preserves exact HTTP attachments and Telegram media/attempt identity', () => {
    const attachments = [{ name: 'secret.txt', mimeType: 'text/plain', data: 'c2VjcmV0' }]
    const httpPlan = planApprovalDelivery(
      approval({ payload: { agentId: 'agent-1', message: '', attachments } }),
      context,
    )
    expect(httpPlan).toMatchObject({
      kind: 'agent_turn',
      approval: { origin: 'http_chat', attemptKind: 'http_chat_ingress', attemptId: 'attempt-1' },
      payload: { attachments },
    })

    const media = {
      kind: 'document' as const,
      fileId: 'telegram-file',
      fileName: 'secret.txt',
      mimeType: 'text/plain',
      fileSize: 6,
    }
    const telegramPlan = planApprovalDelivery(
      approval({
        attemptKind: 'telegram_ingress',
        attemptId: '-100:9',
        origin: 'telegram_agent_topic',
        payloadKind: 'telegram_ingress',
        payload: {
          agentId: 'agent-1',
          text: 'caption',
          media,
          chatId: -100,
          threadId: 42,
          messageId: 9,
        },
      }),
      context,
    )
    expect(telegramPlan).toMatchObject({
      kind: 'telegram_ingress',
      approval: {
        origin: 'telegram_agent_topic',
        attemptKind: 'telegram_ingress',
        attemptId: '-100:9',
      },
      payload: { media },
    })
  })

  test.each([
    ['missing Agent topic', { chatId: -100, messageId: 9 }],
    ['general topic', { chatId: -100, threadId: 1, messageId: 9 }],
    ['zero chat', { chatId: 0, threadId: 42, messageId: 9 }],
    ['non-group chat', { chatId: 100, threadId: 42, messageId: 9 }],
  ])('rejects Telegram Agent-topic ingress with a %s', (_name, transport) => {
    expect(() =>
      planApprovalDelivery(
        approval({
          attemptKind: 'telegram_ingress',
          attemptId: `${transport.chatId}:9`,
          origin: 'telegram_agent_topic',
          payloadKind: 'telegram_ingress',
          payload: {
            agentId: 'agent-1',
            text: 'caption',
            media: null,
            ...transport,
          },
        }),
        context,
      ),
    ).toThrow(/telegram_ingress_payload/)
  })

  test('inbox approval must match the canonical message endpoints', () => {
    const detail = approval({
      attemptKind: 'inbox',
      attemptId: 'message-1',
      operation: 'deliver_agent_message',
      source: { kind: 'agent', id: 'agent-2' },
      target: { kind: 'agent', id: 'agent-1' },
      channel: 'same_team',
      origin: 'agent_inbox',
      payloadKind: 'inbox_message',
      payload: { messageId: 'message-1' },
    })
    expect(() => planApprovalDelivery(detail, context)).toThrow(/agent_to_agent_endpoints/)
  })
})
