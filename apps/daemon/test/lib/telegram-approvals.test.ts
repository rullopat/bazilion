import { randomUUID } from 'node:crypto'
import type { CommandApproval } from '@bazilion/api-types'
import type { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { commandRuleRepo } from '../../src/core/index.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setTelegramTopicId } from '../../src/core/repos/agents.ts'
import * as acl from '../../src/core/repos/telegram-acl.ts'
import { commandApprovalRegistry } from '../../src/lib/bash-approval.ts'
import { scheduleApprovalPrompt, sendApprovalPrompt } from '../../src/lib/telegram/approvals.ts'
import { setTelegramLive, type TelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { type ReplyApi, routeUpdate } from '../../src/lib/telegram/routing.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT = -100
let env: TestEnv
let agentId: string
let turn: AbortController
let live: TelegramLive
const sendMessage = vi.fn()
const editMessageText = vi.fn()
const acks: { text?: string }[] = []
const api = {
  async sendMessage() {
    return { message_id: 900 }
  },
  async answerCallbackQuery(_id: string, opts?: { text?: string }) {
    acks.push(opts ?? {})
    return true
  },
} as unknown as ReplyApi

beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, { id: 'telegram-approval', defaultModel: 'lmstudio:test' })
  agentId = spawnAgent(env.db, env.paths, {
    profileId: 'telegram-approval',
    teamId: env.teamId,
    name: 'Dev',
  }).id
  setTelegramTopicId(env.db, agentId, 42)
  acl.add(env.db, { userId: 123, role: 'owner' })
  acl.add(env.db, { userId: 456, role: 'member' })
  turn = new AbortController()
  acks.length = 0
  sendMessage.mockReset().mockResolvedValue({ message_id: 50 })
  editMessageText.mockReset().mockResolvedValue(true)
  live = {
    api: { sendMessage, editMessageText } as unknown as Api,
    chatId: CHAT,
    db: env.db,
    paths: env.paths,
  }
  setTelegramLive(live)
})
afterEach(() => {
  turn.abort()
  vi.useRealTimers()
  setTelegramLive(null)
  _resetOutboundQueueForTest()
  env.cleanup()
})

function begin(): { approval: CommandApproval; settled: Promise<CommandApproval> } {
  return commandApprovalRegistry.begin(
    {
      id: randomUUID(),
      turnId: 't1',
      toolCallId: 'call1',
      agentId,
      teamId: env.teamId,
      command: 'rm -rf build/',
      risks: [
        {
          code: 'broad-destructive-operation',
          message: 'Deletes files recursively.',
          span: { start: 0, end: 6 },
        },
      ],
      mode: 'interactive',
    },
    turn.signal,
  )
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

test('a command still waiting after the delay goes to its topic; the owner allows it there', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { approval, settled } = begin()
  scheduleApprovalPrompt(approval)
  await vi.advanceTimersByTimeAsync(29_000)
  expect(sendMessage).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1_000)
  vi.useRealTimers()
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
  const [chat, body, opts] = sendMessage.mock.calls[0] ?? []
  expect(chat).toBe(CHAT)
  expect(body).toContain('Dev wants to run a command that needs your approval')
  expect(body).toContain('rm -rf build/')
  expect(body).toContain('Deletes files recursively.')
  expect(opts).toEqual({
    message_thread_id: 42,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Allow once', callback_data: `ba:${approval.id}:a` },
          { text: 'Deny', callback_data: `ba:${approval.id}:d` },
        ],
        [{ text: 'Always: rm', callback_data: `ba:${approval.id}:r` }],
      ],
    },
  })

  // Another allowed member may not decide on a command.
  expect(await route(tap(`ba:${approval.id}:a`, 456))).toEqual({ kind: 'approval_decision' })
  expect(acks.at(-1)).toEqual({ text: 'Only the owner can decide on a command.' })
  expect(commandApprovalRegistry.get(approval.id)).toBeDefined()

  expect(await route(tap(`ba:${approval.id}:a`))).toEqual({ kind: 'approval_decision' })
  expect(acks.at(-1)).toEqual({ text: 'Allowed once.' })
  expect((await settled).status).toBe('allowed')
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  expect(editMessageText.mock.calls[0]?.[2]).toContain('Allowed once.')
  expect(editMessageText.mock.calls[0]?.[3]).toEqual({ reply_markup: { inline_keyboard: [] } })

  await route(tap(`ba:${approval.id}:d`))
  expect(acks.at(-1)).toEqual({ text: 'That command is no longer waiting.' })
})

test('Always allows the command and keeps a rule for the Agent', async () => {
  const { approval, settled } = begin()
  expect(await sendApprovalPrompt(approval)).toBe(true)
  expect(await route(tap(`ba:${approval.id}:r`))).toEqual({ kind: 'approval_decision' })
  expect(acks.at(-1)).toEqual({
    text: 'Allowed, and from now on for commands that start with rm.',
  })
  expect((await settled).status).toBe('allowed')
  expect(commandRuleRepo.list(env.db, agentId).map((rule) => rule.prefix)).toEqual(['rm'])
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  expect(editMessageText.mock.calls[0]?.[2]).toContain(
    'from now on for commands that start with rm',
  )
})

test('a command decided in the web UI before the delay never reaches Telegram', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { approval, settled } = begin()
  scheduleApprovalPrompt(approval)
  commandApprovalRegistry.respond(approval.id, 'deny')
  await settled
  await vi.advanceTimersByTimeAsync(60_000)
  expect(sendMessage).not.toHaveBeenCalled()
})

test('an Agent without a topic, or Telegram off, gets no prompt', async () => {
  const { approval } = begin()
  setTelegramTopicId(env.db, agentId, null)
  expect(await sendApprovalPrompt(approval)).toBe(false)
  setTelegramTopicId(env.db, agentId, 42)
  setTelegramLive(null)
  expect(await sendApprovalPrompt(approval)).toBe(false)
  expect(sendMessage).not.toHaveBeenCalled()
})

test('a prompt whose command expires says so', async () => {
  const { approval, settled } = begin()
  expect(await sendApprovalPrompt(approval)).toBe(true)
  turn.abort()
  expect((await settled).status).toBe('cancelled')
  await vi.waitFor(() => expect(editMessageText).toHaveBeenCalledOnce())
  expect(editMessageText.mock.calls[0]?.[2]).toContain('The turn ended before an answer.')
})
