// Router classification + side-effect tests. Each test feeds a Telegram-
// shaped Update object to routeUpdate(); the mock ReplyApi records every
// sendMessage / createForumTopic call so we can assert the right thing was
// sent in reply.

import type { Update } from 'grammy/types'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import {
  _resetRouterStateForTest,
  type ReplyApi,
  routeUpdate,
} from '../../src/lib/telegram/routing.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972
const SERVICE_TOPIC = 100

function makeReplyApi(): {
  api: ReplyApi
  sends: { chatId: number; text: string; opts: unknown }[]
  creates: { chatId: number; name: string; opts: unknown }[]
} {
  const sends: { chatId: number; text: string; opts: unknown }[] = []
  const creates: { chatId: number; name: string; opts: unknown }[] = []
  let nextTopicId = 200
  const api: ReplyApi = {
    async sendMessage(chatId, text, opts) {
      sends.push({ chatId, text, opts })
      return { message_id: 1 }
    },
    async createForumTopic(chatId, name, opts) {
      creates.push({ chatId, name, opts })
      return { message_thread_id: nextTopicId++ }
    },
  }
  return { api, sends, creates }
}

function messageUpdate(opts: {
  updateId?: number
  chatId?: number
  text?: string
  threadId?: number
  fromUserId?: number
  fromUsername?: string
}): Update {
  return {
    update_id: opts.updateId ?? 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? CHAT_ID, type: 'supergroup', title: 'Test' } as never,
      from: {
        id: opts.fromUserId ?? 11,
        is_bot: false,
        first_name: 'P',
        username: opts.fromUsername ?? 'rullopat',
      },
      ...(opts.threadId !== undefined ? { message_thread_id: opts.threadId } : {}),
      ...(opts.text !== undefined ? { text: opts.text } : {}),
    },
  } as Update
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  // Stash the service topic id so routing can recognize the ⚙ bazilion chat.
  openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', String(SERVICE_TOPIC))
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
  _resetRouterStateForTest()
})
afterEach(() => env.cleanup())

describe('routeUpdate classification', () => {
  test('non-message updates flow through with kind=non_message', async () => {
    const { api, sends } = makeReplyApi()
    const u: Update = { update_id: 1, my_chat_member: {} as never }
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 'tok', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('non_message')
    expect(sends.length).toBe(0)
  })

  test('foreign chat (private DM with the bot) is recognized but ignored', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ chatId: 11, text: 'hi' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('foreign_chat')
    expect(sends.length).toBe(0)
  })

  test('General topic (no thread_id) triggers a redirect once, then suppresses for 60s', async () => {
    const { api, sends } = makeReplyApi()
    const deps = { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID }

    const first = await routeUpdate(deps, messageUpdate({ text: 'hello' }))
    expect(first.kind).toBe('general_redirect')
    if (first.kind === 'general_redirect') expect(first.suppressed).toBe(false)
    expect(sends.length).toBe(1)

    const second = await routeUpdate(deps, messageUpdate({ text: 'hello again', updateId: 2 }))
    expect(second.kind).toBe('general_redirect')
    if (second.kind === 'general_redirect') expect(second.suppressed).toBe(true)
    // No additional sendMessage call within the suppression window.
    expect(sends.length).toBe(1)
  })

  test('service-chat plain text gets a "/help" nudge', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: 'random chatter' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_plain_text')
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toMatch(/\/help/)
  })

  test('service-chat slash command dispatches /help', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/help' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_command')
    if (outcome.kind === 'service_command') {
      expect(outcome.name).toBe('help')
      expect(outcome.handled).toBe(true)
    }
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toMatch(/bazilion/i)
    expect(sends[0]?.text).toMatch(/\/talk/)
  })

  test('service-chat unknown command surfaces with a hint', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/nope' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_unknown_command')
    if (outcome.kind === 'service_unknown_command') expect(outcome.name).toBe('nope')
    expect(sends[0]?.text).toMatch(/Unknown command/)
  })

  test('service-chat /talk creates a topic for an existing agent', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    const { api, sends, creates } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/talk r1' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_command')
    // The createForumTopic API call landed.
    expect(creates.length).toBe(1)
    // The reply links into the new topic and confirms creation.
    expect(sends[0]?.text).toMatch(/Created topic for/)
    expect(sends[0]?.text).toMatch(/<a href="/)
    // And the binding persisted.
    expect(agentRepo.getTelegramTopicId(env.db, agent.id)).not.toBeNull()
  })

  test('agent-topic inbound identifies the agent but sends no reply (step 3 behavior)', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: 'hi agent' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic')
    if (outcome.kind === 'agent_topic') expect(outcome.agentId).toBe(agent.id)
    expect(sends.length).toBe(0)
  })

  test('unknown topic (not service, not bound) gets a "not bound" reply', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 9999, text: 'lost' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('unknown_topic')
    if (outcome.kind === 'unknown_topic') expect(outcome.topicId).toBe(9999)
    expect(sends[0]?.text).toMatch(/isn.+t bound/)
  })
})
