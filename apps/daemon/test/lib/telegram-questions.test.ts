import type { AgentQuestion, AgentQuestionToolResult } from '@bazilion/api-types'
import type { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import * as userQueue from '../../src/core/repos/user-queue.ts'
import { questionRegistry } from '../../src/lib/questions.ts'
import { setTelegramLive, type TelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import {
  _resetQuestionPromptsForTest,
  sendQuestionPrompt,
} from '../../src/lib/telegram/questions.ts'
import { type ReplyApi, routeUpdate } from '../../src/lib/telegram/routing.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { seedRegisteredConversation } from '../fixtures/conversation.ts'

const CHAT = -100
let env: TestEnv
let agentId: string
let conversationId: string
let turn: AbortController
let live: TelegramLive
const sendMessage = vi.fn()
const editMessageText = vi.fn()
const replies: { text: string }[] = []
const acks: { text?: string }[] = []
const api = {
  async sendMessage(_chat: number, text: string) {
    replies.push({ text })
    return { message_id: 900 }
  },
  async answerCallbackQuery(_id: string, opts?: { text?: string }) {
    acks.push(opts ?? {})
    return true
  },
} as unknown as ReplyApi

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'telegram-question', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'telegram-question', teamId: env.teamId }).id
  setTelegramTopicId(env.db, agentId, 42)
  acl.add(env.db, { userId: 123, role: 'owner' })
  conversationId = seedRegisteredConversation(env.db, env.paths, agentId).id
  turn = new AbortController()
  replies.length = 0
  acks.length = 0
  sendMessage.mockReset().mockResolvedValue({ message_id: 50 })
  editMessageText.mockReset().mockResolvedValue(true)
  live = {
    api: {
      sendMessage,
      editMessageText,
      setMessageReaction: vi.fn().mockResolvedValue(true),
    } as unknown as Api,
    chatId: CHAT,
    db: env.db,
    paths: env.paths,
  }
  setTelegramLive(live)
})
afterEach(() => {
  turn.abort()
  setTelegramLive(null)
  _resetQuestionPromptsForTest()
  _resetOutboundQueueForTest()
  env.cleanup()
})

async function ask(
  input: unknown = { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
): Promise<{
  question: AgentQuestion
  result: Promise<AgentQuestionToolResult>
}> {
  const asked = questionRegistry.ask({ agentId, conversationId }, input, turn.signal)
  await sendQuestionPrompt(live, 42, asked.question)
  return asked
}
const route = (update: Partial<Update>) =>
  routeUpdate({ db: env.db, paths: env.paths, api, chatId: CHAT }, {
    update_id: 1,
    ...update,
  } as Update)
const tap = (data: string, from = 123): Partial<Update> => ({
  callback_query: {
    id: 'tap',
    from: { id: from, is_bot: false, first_name: 'P' },
    data,
    chat_instance: 'c',
    message: { message_id: 50, message_thread_id: 42, chat: { id: CHAT }, date: 1 },
  } as never,
})
const text = (body: string, replyTo?: number): Partial<Update> => ({
  message: {
    message_id: 70,
    date: 1,
    chat: { id: CHAT, type: 'supergroup', title: 'T' },
    from: { id: 123, is_bot: false, first_name: 'P' },
    message_thread_id: 42,
    text: body,
    ...(replyTo === undefined ? {} : { reply_to_message: { message_id: replyTo } }),
  } as never,
})

test('a question goes to its topic with one button per choice and settles into the outcome', async () => {
  const { question, result } = await ask()
  expect(sendMessage).toHaveBeenCalledOnce()
  const [chat, body, opts] = sendMessage.mock.calls[0] ?? []
  expect(chat).toBe(CHAT)
  expect(body).toContain('Format?')
  expect(body).toContain('2. JSON')
  expect(opts).toEqual({
    message_thread_id: 42,
    reply_markup: {
      inline_keyboard: [
        [{ text: '1. Text', callback_data: `bq:${question.id}:0` }],
        [{ text: '2. JSON', callback_data: `bq:${question.id}:1` }],
        [{ text: 'Skip', callback_data: `bq:${question.id}:s` }],
      ],
    },
  })
  expect(await route(tap(`bq:${question.id}:1`))).toEqual({ kind: 'question_answer' })
  expect(acks).toEqual([{ text: 'Answered.' }])
  expect(await result).toMatchObject({ kind: 'answer', answer: { kind: 'choice', index: 1 } })
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  expect(editMessageText.mock.calls[0]?.[2]).toContain('Answered: JSON')
  expect(editMessageText.mock.calls[0]?.[3]).toEqual({ reply_markup: { inline_keyboard: [] } })

  await route(tap(`bq:${question.id}:0`))
  expect(acks.at(-1)).toEqual({ text: 'That question is no longer open.' })
})

test('a reply to the prompt answers with text instead of queueing', async () => {
  const { result } = await ask()
  expect(await route(text('YAML, please', 50))).toEqual({ kind: 'question_answer' })
  expect(await result).toMatchObject({
    kind: 'answer',
    answer: { kind: 'text', text: 'YAML, please' },
  })
  expect(replies).toEqual([{ text: 'Answered.' }])
  expect(userQueue.pendingCount(env.db, agentId)).toBe(0)
  // The paced prompt edit lands before the next test starts.
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  expect(editMessageText.mock.calls[0]?.[2]).toContain('Answered: YAML, please')
})

test('other messages queue as usual and other people cannot answer', async () => {
  const { question } = await ask()
  expect(await route(text('something else'))).toMatchObject({ kind: 'agent_topic', queued: true })
  expect(await route(tap(`bq:${question.id}:1`, 999))).toEqual({
    kind: 'unauthorized',
    userId: 999,
  })
  expect(questionRegistry.get(question.id)).toBeDefined()
})

test('the settled prompt keeps its outcome within one Telegram message', async () => {
  // A full-length prompt plus long choices, answered with a long text.
  const { question, result } = await ask({
    prompt: 'p'.repeat(2000),
    choices: [1, 2, 3, 4].map((n) => ({
      label: String(n).repeat(100),
      description: 'd'.repeat(336),
    })),
  })
  expect(String(sendMessage.mock.calls[0]?.[1]).length).toBeLessThanOrEqual(4096)
  questionRegistry.answer(agentId, question.id, { kind: 'text', text: 'a'.repeat(4096) })
  await result
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  const edited = String(editMessageText.mock.calls[0]?.[2])
  expect(edited.length).toBeLessThanOrEqual(4096)
  expect(edited.endsWith(`Answered: ${'a'.repeat(499)}…`)).toBe(true)
})

test('a question that settles after the bot stopped or moved chats is not edited', async () => {
  const first = await ask()
  setTelegramLive(null)
  questionRegistry.answer(agentId, first.question.id, { kind: 'skip' })
  await first.result
  setTelegramLive({ ...live, chatId: -200 })
  const second = await ask()
  questionRegistry.answer(agentId, second.question.id, { kind: 'skip' })
  await second.result
  await new Promise((resolve) => setImmediate(resolve))
  expect(sendMessage).toHaveBeenCalledTimes(2)
  expect(editMessageText).not.toHaveBeenCalled()
})
