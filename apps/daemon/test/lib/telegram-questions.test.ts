import { randomUUID } from 'node:crypto'
import type { CallbackQuery, Message } from 'grammy/types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import * as questions from '../../src/core/repos/questions.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import {
  _resetOutboundQueueForTest,
  enqueueOutbound,
} from '../../src/lib/telegram/outbound-queue.ts'
import {
  installQuestionTransport,
  parseTelegramQuestionReply,
  telegramQuestionTransport,
} from '../../src/lib/telegram/question-transport.ts'
import {
  captureTelegramQueueBinding,
  type TelegramQueueBinding,
} from '../../src/lib/telegram/queue-binding.ts'
import { type ReplyApi, routeUpdate } from '../../src/lib/telegram/routing.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

let env: TestEnv
let item: ReturnType<typeof questions.create>
let binding: TelegramQueueBinding
const send = vi.fn()
const edit = vi.fn()
beforeEach(() => {
  env = makeTestEnv()
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'question-fixture-token')
  vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
  createProfile(env.db, env.paths, { id: 'telegram-question', defaultModel: 'lmstudio:test' })
  const agent = spawnAgent(env.db, env.paths, {
    profileId: 'telegram-question',
    teamId: env.teamId,
  })
  setTelegramTopicId(env.db, agent.id, 42)
  acl.add(env.db, { userId: 123, role: 'owner' })
  const conversation = seedRegisteredConversation(env.db, env.paths, agent.id)
  binding = captureTelegramQueueBinding(env.db, 'test', {
    origin: 'telegram_agent_topic',
    attemptKind: 'telegram_ingress',
    attemptId: '-100:5',
    requester: 'telegram:123',
    approvalPayloadKind: 'telegram_ingress',
    approvalPayload: {
      agentId: agent.id,
      conversationId: conversation.id,
      text: 'ask',
      media: null,
      chatId: -100,
      threadId: 42,
      messageId: 5,
    },
  })
  item = questions.create(env.db, {
    agentId: agent.id,
    teamId: env.teamId,
    conversationId: conversation.id,
    turnId: randomUUID(),
    toolCallId: 'telegram-ask',
    question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    binding,
  })
  send.mockReset()
  edit.mockReset()
  edit.mockResolvedValue(undefined)
  send.mockImplementation(async () => ({ message_id: 50 + send.mock.calls.length }))
  installQuestionTransport(() => ({
    db: env.db,
    authToken: 'test',
    botToken: 'question-fixture-token',
    send,
    edit,
  }))
})
afterEach(() => {
  installQuestionTransport(null)
  _resetOutboundQueueForTest()
  vi.unstubAllEnvs()
  env.cleanup()
})
function callback(overrides: Record<string, unknown> = {}): CallbackQuery {
  return {
    id: 'tap-1',
    from: { id: 123, is_bot: false },
    data: `bq:${item.id}:1`,
    message: { message_id: 52, message_thread_id: 42, chat: { id: -100 }, date: 1 },
    ...overrides,
  } as CallbackQuery
}
test('buttons bind owner, topic, exact prompt, question and stable answer request identity', async () => {
  const authorize = vi.fn()
  await telegramQuestionTransport(env.db, 'test').send(item, binding, authorize)
  const reply = parseTelegramQuestionReply(env.db, 'test', { callback: callback() })
  expect(reply).toMatchObject({
    kind: 'answer',
    agentId: item.agentId,
    questionId: item.id,
    input: { conversationId: item.conversationId, answer: { kind: 'choice', index: 1 } },
  })
  expect(parseTelegramQuestionReply(env.db, 'test', { callback: callback() })).toEqual(reply)
  expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(3)
  for (const bad of [
    callback({ from: { id: 456, is_bot: false } }),
    callback({ message: { message_id: 51, message_thread_id: 42, chat: { id: -100 } } }),
    callback({ message: { message_id: 52, message_thread_id: 43, chat: { id: -100 } } }),
  ])
    expect(parseTelegramQuestionReply(env.db, 'test', { callback: bad }).kind).toBe('rejected')
  setTelegramTopicId(env.db, item.agentId, 43)
  expect(parseTelegramQuestionReply(env.db, 'test', { callback: callback() }).kind).toBe('rejected')
})
test('exact text replies and explicit IDs correlate, while unrelated text stays unrelated', async () => {
  await telegramQuestionTransport(env.db, 'test').send(item, binding, () => {})
  const message = {
    message_id: 90,
    message_thread_id: 42,
    chat: { id: -100 },
    from: { id: 123, is_bot: false },
    text: 'CSV',
    reply_to_message: { message_id: 52, text: `Question ${item.id}\nOptions` },
  } as Message
  expect(parseTelegramQuestionReply(env.db, 'test', { message })).toMatchObject({
    kind: 'answer',
    input: { answer: { kind: 'text', text: 'CSV' } },
  })
  expect(
    parseTelegramQuestionReply(env.db, 'test', {
      message: { ...message, reply_to_message: undefined },
    }).kind,
  ).toBe('unrelated')
  expect(
    parseTelegramQuestionReply(env.db, 'test', {
      message: { ...message, reply_to_message: undefined, text: `/answer ${item.id} CSV` },
    }),
  ).toMatchObject({ kind: 'answer', input: { answer: { kind: 'text', text: 'CSV' } } })
  expect(
    parseTelegramQuestionReply(env.db, 'test', {
      message: { ...message, text: `/answer ${randomUUID()} CSV`, reply_to_message: undefined },
    }).kind,
  ).toBe('rejected')
})
test('abort while queued settles promptly and never sends after pacing unblocks', async () => {
  let release: () => void = () => {}
  const first = enqueueOutbound(
    -100,
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    { minIntervalMs: 0 },
  )
  await Promise.resolve()
  const controller = new AbortController()
  const result = telegramQuestionTransport(env.db, 'test').send(
    item,
    binding,
    () => {},
    controller.signal,
  )
  controller.abort()
  await expect(result).rejects.toThrow('turn ended')
  release()
  await first
  await enqueueOutbound(-100, async () => {}, { minIntervalMs: 0 })
  expect(send).not.toHaveBeenCalled()
})
test('partial delivery failure does not register an answer target or retry an uncertain send', async () => {
  send.mockResolvedValueOnce({ message_id: 51 }).mockRejectedValueOnce(new Error('socket timeout'))
  await expect(
    telegramQuestionTransport(env.db, 'test').send(item, binding, () => {}),
  ).rejects.toThrow('socket timeout')
  expect(send).toHaveBeenCalledTimes(2)
  expect(parseTelegramQuestionReply(env.db, 'test', { callback: callback() }).kind).toBe('rejected')
  expect(questions.get(env.db, item.agentId, item.id)?.deliveredAt).toBeNull()
})
test('a rate-limit retry revalidates the destination before sending', async () => {
  send.mockImplementationOnce(async () => {
    setTelegramTopicId(env.db, item.agentId, 43)
    throw { error_code: 429, parameters: { retry_after: 0 } }
  })
  await expect(
    telegramQuestionTransport(env.db, 'test').send(item, binding, () => {}),
  ).rejects.toThrow()
  expect(send).toHaveBeenCalledTimes(1)
  expect(parseTelegramQuestionReply(env.db, 'test', { callback: callback() }).kind).toBe('rejected')
})
test('expiry while queued rejects promptly and prevents a later prompt', async () => {
  let release: () => void = () => {}
  const first = enqueueOutbound(
    -100,
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    {
      minIntervalMs: 0,
    },
  )
  await Promise.resolve()
  const result = telegramQuestionTransport(env.db, 'test').send(
    { ...item, expiresAt: Date.now() + 30 },
    binding,
    () => {},
  )
  await expect(result).rejects.toThrow('delivery expired')
  release()
  await first
  await enqueueOutbound(-100, async () => {}, { minIntervalMs: 0 })
  expect(send).not.toHaveBeenCalled()
})
test('maximum prompt and choices are split within Telegram bounds and keep buttons on the exact final prompt', async () => {
  const large = {
    ...item,
    question: {
      prompt: 'a'.repeat(4096),
      choices: Array.from({ length: 4 }, (_, index) => ({
        label: `${index}${'b'.repeat(119)}`,
        description: 'c'.repeat(500),
      })),
    },
  }
  await telegramQuestionTransport(env.db, 'test').send(large, binding, () => {})
  expect(send).toHaveBeenCalledTimes(3)
  for (const call of send.mock.calls) expect(String(call[2]).length).toBeLessThanOrEqual(4096)
  expect(send.mock.calls[0]?.[3]).toBeUndefined()
  expect(send.mock.calls[2]?.[3]).toMatchObject({ inline_keyboard: expect.any(Array) })
})
test('a correlated reply whose waiter is gone is handled without entering the follow-up queue', async () => {
  await telegramQuestionTransport(env.db, 'test').send(item, binding, () => {})
  const api = {
    sendMessage: vi.fn(async () => ({ message_id: 99 })),
    answerCallbackQuery: vi.fn(async () => {}),
  } as unknown as ReplyApi
  const outcome = await routeUpdate(
    {
      db: env.db,
      paths: env.paths,
      authToken: 'test',
      api,
      chatId: -100,
      botToken: 'question-fixture-token',
    },
    { update_id: 100, callback_query: callback() },
  )
  expect(outcome).toEqual({ kind: 'question_reply', status: 'rejected' })
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM user_queue_items').get()?.n,
  ).toBe(0)
  expect(api.answerCallbackQuery).toHaveBeenCalledOnce()
})
test('settlement updates only the captured prompt with minimal status and rechecks binding', async () => {
  const transport = telegramQuestionTransport(env.db, 'test')
  await transport.send(item, binding, () => {})
  if (!transport.settled) throw new Error('Missing settlement updater')
  const outcome = {
    ...item,
    status: 'answered' as const,
    continuation: 'unconfirmed' as const,
    answer: { kind: 'text' as const, text: 'PRIVATE_ANSWER' },
  }
  await transport.settled(outcome, () => {})
  expect(edit).toHaveBeenCalledOnce()
  expect(edit.mock.calls[0]?.slice(0, 2)).toEqual([-100, 52])
  expect(edit.mock.calls[0]?.[2]).toContain('Answer accepted; consumption is not yet confirmed')
  expect(edit.mock.calls[0]?.[2]).not.toContain('PRIVATE_ANSWER')
  setTelegramTopicId(env.db, item.agentId, 43)
  await expect(transport.settled(outcome, () => {})).rejects.toThrow()
  expect(edit).toHaveBeenCalledOnce()
})
