import type { TelegramHealth } from '@bazilion/api-types'
import { describe, expect, test } from 'vitest'
import { runPreflight } from '../../src/lib/telegram/preflight.ts'

// Fake Bot API server — answers getMe / getChat / getChatMember from a
// per-test scripted map. The preflight helper does one POST per method.

type MethodName = 'getMe' | 'getChat' | 'getChatMember'

interface ScriptedResult {
  ok: boolean
  result?: unknown
  description?: string
}

interface FakeApi {
  fetchFn: typeof fetch
  calls: { method: MethodName; body: unknown }[]
}

function fakeApi(script: Partial<Record<MethodName, ScriptedResult>>): FakeApi {
  const calls: { method: MethodName; body: unknown }[] = []
  const fetchFn: typeof fetch = async (url, init) => {
    const u = typeof url === 'string' ? url : (url as URL).toString()
    const method = u.split('/').at(-1) as MethodName
    const body = init?.body ? JSON.parse(init.body as string) : {}
    calls.push({ method, body })
    const scripted = script[method]
    if (!scripted) {
      throw new Error(`unexpected Bot API call: ${method}`)
    }
    return new Response(JSON.stringify(scripted), {
      status: scripted.ok ? 200 : 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchFn, calls }
}

const TOKEN = '1234567890:ABCDEF'
const CHAT = '-1009999'

describe('runPreflight', () => {
  test('all green — admin bot with manage_topics and privacy off in a forum', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 42, username: 'mybot', can_read_all_group_messages: true },
      },
      getChat: {
        ok: true,
        result: { id: -1009999, type: 'supergroup', title: 'My Forum', is_forum: true },
      },
      getChatMember: {
        ok: true,
        result: { status: 'administrator', can_manage_topics: true },
      },
    })

    const h: TelegramHealth = await runPreflight({
      botToken: TOKEN,
      chatId: CHAT,
      fetchFn: api.fetchFn,
    })

    expect(h.configured).toBe(true)
    expect(h.error).toBeNull()
    expect(h.polling).toBeNull()
    expect(h.preflight).not.toBeNull()
    expect(h.preflight).toEqual({
      botUsername: 'mybot',
      chatTitle: 'My Forum',
      isForum: true,
      hasManageTopics: true,
      privacyModeOff: true,
    })
    expect(api.calls.map((c) => c.method)).toEqual(['getMe', 'getChat', 'getChatMember'])
    expect(api.calls[1]!.body).toEqual({ chat_id: -1009999 })
    expect(api.calls[2]!.body).toEqual({ chat_id: -1009999, user_id: 42 })
  })

  test('group owner ("creator") is treated as having manage_topics implicitly', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't', is_forum: true } },
      getChatMember: { ok: true, result: { status: 'creator' } },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.preflight?.hasManageTopics).toBe(true)
  })

  test('forum mode off surfaces as isForum=false but preflight still returns', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't' /* no is_forum */ } },
      getChatMember: {
        ok: true,
        result: { status: 'administrator', can_manage_topics: true },
      },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.error).toBeNull()
    expect(h.preflight?.isForum).toBe(false)
  })

  test('privacy mode on (the silent-failure trap) surfaces as privacyModeOff=false', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: false },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't', is_forum: true } },
      getChatMember: {
        ok: true,
        result: { status: 'administrator', can_manage_topics: true },
      },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.preflight?.privacyModeOff).toBe(false)
  })

  test('member without can_manage_topics surfaces as hasManageTopics=false', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't', is_forum: true } },
      // Bot is in the chat but not promoted; getChatMember returns status=member.
      getChatMember: { ok: true, result: { status: 'member' } },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.preflight?.hasManageTopics).toBe(false)
  })

  test('getMe failure short-circuits with error.step=getMe', async () => {
    const api = fakeApi({
      getMe: { ok: false, description: 'Unauthorized' },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.preflight).toBeNull()
    expect(h.error).toEqual({ step: 'getMe', message: 'Unauthorized' })
    expect(api.calls.length).toBe(1)
  })

  test('getChat failure short-circuits with error.step=getChat', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: false, description: 'chat not found' },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.error).toEqual({ step: 'getChat', message: 'chat not found' })
    expect(api.calls.map((c) => c.method)).toEqual(['getMe', 'getChat'])
  })

  test('getChatMember failure surfaces step=getChatMember', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't', is_forum: true } },
      getChatMember: { ok: false, description: 'user not found' },
    })
    const h = await runPreflight({ botToken: TOKEN, chatId: CHAT, fetchFn: api.fetchFn })
    expect(h.error).toEqual({ step: 'getChatMember', message: 'user not found' })
  })

  test('chat id with @username passes through as a string', async () => {
    const api = fakeApi({
      getMe: {
        ok: true,
        result: { id: 1, username: 'b', can_read_all_group_messages: true },
      },
      getChat: { ok: true, result: { id: -1, type: 'supergroup', title: 't', is_forum: true } },
      getChatMember: {
        ok: true,
        result: { status: 'administrator', can_manage_topics: true },
      },
    })
    await runPreflight({ botToken: TOKEN, chatId: '@myforum', fetchFn: api.fetchFn })
    expect(api.calls[1]!.body).toEqual({ chat_id: '@myforum' })
  })
})
