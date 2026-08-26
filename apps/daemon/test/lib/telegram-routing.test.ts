// Router classification + side-effect tests. Each test feeds a Telegram-
// shaped Update object to routeUpdate(); the mock ReplyApi records every
// sendMessage / createForumTopic call so we can assert the right thing was
// sent in reply.

import type { Update } from 'grammy/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import * as telegramAclRepo from '../../src/core/repos/telegram-acl.ts'
import * as inboundQueue from '../../src/lib/telegram/inbound-queue.ts'
import {
  _resetRouterStateForTest,
  type ReplyApi,
  routeUpdate,
} from '../../src/lib/telegram/routing.ts'
import { _resetSpawnStateForTest } from '../../src/lib/telegram/spawn-state.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972
const SERVICE_TOPIC = 100

function makeReplyApi(): {
  api: ReplyApi
  sends: { chatId: number; text: string; opts: unknown }[]
  creates: { chatId: number; name: string; opts: unknown }[]
  edits: { chatId: number; messageId: number; text: string; opts: unknown }[]
  acks: { id: string; opts: unknown }[]
} {
  const sends: { chatId: number; text: string; opts: unknown }[] = []
  const creates: { chatId: number; name: string; opts: unknown }[] = []
  const edits: { chatId: number; messageId: number; text: string; opts: unknown }[] = []
  const acks: { id: string; opts: unknown }[] = []
  let nextMessageId = 100
  let nextTopicId = 200
  const api: ReplyApi = {
    async sendMessage(chatId, text, opts) {
      sends.push({ chatId, text, opts })
      return { message_id: nextMessageId++ }
    },
    async createForumTopic(chatId, name, opts) {
      creates.push({ chatId, name, opts })
      return { message_thread_id: nextTopicId++ }
    },
    async editMessageText(chatId, messageId, text, opts) {
      edits.push({ chatId, messageId, text, opts: opts ?? {} })
      return true
    },
    async answerCallbackQuery(id, opts) {
      acks.push({ id, opts: opts ?? {} })
      return true
    },
    async closeForumTopic() {
      return true
    },
    async getFile() {
      return {}
    },
  }
  return { api, sends, creates, edits, acks }
}

function messageUpdate(opts: {
  updateId?: number
  chatId?: number
  text?: string
  threadId?: number
  fromUserId?: number
  fromUsername?: string
  fromIsBot?: boolean
}): Update {
  return {
    update_id: opts.updateId ?? 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? CHAT_ID, type: 'supergroup', title: 'Test' } as never,
      from: {
        id: opts.fromUserId ?? 11,
        is_bot: opts.fromIsBot ?? false,
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
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  _resetRouterStateForTest()
  _resetSpawnStateForTest()
  // Seed the default sender (user 11) as an allowlisted owner so the Phase 7
  // ACL gate doesn't claim/deny in tests that pre-date it. ACL-specific tests
  // start from a fresh env (no seed) to exercise pairing + deny.
  telegramAclRepo.add(env.db, { userId: 11, role: 'owner', label: 'P' })
})
afterEach(() => env.cleanup())

describe('routeUpdate classification', () => {
  test('approval-required Telegram ingress holds media before lookup and returns pending status', async () => {
    const agent = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    env.db.raw.run(
      `UPDATE team_policy_edges SET posture = 'approval_required'
       WHERE team_id = ? AND source_kind = 'user' AND target_kind = 'agent'
         AND target_id = ?`,
      [env.teamId, agent.id],
    )
    const previous = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    const { api, sends } = makeReplyApi()
    let lookups = 0
    api.getFile = async () => {
      lookups++
      return { file_path: 'secret.jpg' }
    }
    const update = messageUpdate({ threadId: 42 })
    ;(
      update.message as never as {
        photo: Array<{ file_id: string; file_size: number; width: number; height: number }>
      }
    ).photo = [{ file_id: 'secret', file_size: 4, width: 1, height: 1 }]
    try {
      const outcome = await routeUpdate(
        { db: env.db, paths: env.paths, authToken: 'token', botToken: 'bot', api, chatId: CHAT_ID },
        update,
      )
      expect(outcome).toMatchObject({ kind: 'agent_topic', queued: false })
      expect(lookups).toBe(0)
      expect(inboundQueue.pendingMessageCount(agent.id)).toBe(0)
      expect(sends.at(-1)?.text).toMatch(/pending approval/)
      expect(
        env.db.raw
          .query<{ count: number }, []>('SELECT COUNT(*) count FROM communication_approvals')
          .get()?.count,
      ).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
      else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = previous
    }
  })

  test('policy denial happens before Telegram media lookup or download', async () => {
    const agent = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    env.db.raw.run("DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'user'", [
      env.teamId,
    ])
    const previous = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    const { api, sends } = makeReplyApi()
    let lookups = 0
    api.getFile = async () => {
      lookups++
      return { file_path: 'secret.jpg' }
    }
    const update = messageUpdate({ threadId: 42 })
    ;(
      update.message as never as {
        photo: Array<{ file_id: string; file_size: number; width: number; height: number }>
      }
    ).photo = [{ file_id: 'secret', file_size: 4, width: 1, height: 1 }]
    try {
      const outcome = await routeUpdate(
        { db: env.db, paths: env.paths, authToken: 'token', botToken: 'bot', api, chatId: CHAT_ID },
        update,
      )
      expect(outcome).toMatchObject({ kind: 'agent_topic', queued: false })
      expect(lookups).toBe(0)
      expect(inboundQueue.pendingMessageCount(agent.id)).toBe(0)
      expect(sends.at(-1)?.text).toMatch(/blocked by Team policy/)
    } finally {
      if (previous === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
      else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = previous
    }
  })

  test('policy changes during media fetch preserve the exact queued attempt for final revalidation', async () => {
    const agent = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const previous = process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
    process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
    const { api } = makeReplyApi()
    const queued: unknown[][] = []
    vi.spyOn(inboundQueue, 'enqueueAgentMessage').mockImplementation((...args) => {
      queued.push(args)
    })
    api.getFile = async () => ({ file_path: 'secret.jpg' })
    vi.stubGlobal('fetch', async () => {
      env.db.raw.run("DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'user'", [
        env.teamId,
      ])
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
    })
    const update = messageUpdate({ threadId: 42 })
    ;(
      update.message as never as {
        photo: Array<{ file_id: string; file_size: number; width: number; height: number }>
      }
    ).photo = [{ file_id: 'secret', file_size: 3, width: 1, height: 1 }]
    try {
      const outcome = await routeUpdate(
        { db: env.db, paths: env.paths, authToken: 'token', botToken: 'bot', api, chatId: CHAT_ID },
        update,
      )
      expect(outcome).toMatchObject({ kind: 'agent_topic', queued: true })
      expect(queued).toHaveLength(1)
      expect(queued[0]?.[0]).toBe(agent.id)
      expect(queued[0]?.[1]).toBe('')
      expect(queued[0]?.[2]).toEqual([{ mimeType: 'image/jpeg', data: 'AQID' }])
      expect(queued[0]?.[3]).toMatchObject({
        origin: 'telegram_agent_topic',
        attemptKind: 'telegram_ingress',
        attemptId: `${CHAT_ID}:1`,
        approvalPayloadKind: 'telegram_ingress',
        requester: 'telegram:11',
        approvalPayload: {
          agentId: agent.id,
          text: '',
          media: {
            kind: 'photo',
            fileId: 'secret',
            fileName: null,
            mimeType: 'image/jpeg',
            fileSize: 3,
          },
          chatId: CHAT_ID,
          threadId: 42,
          messageId: 1,
        },
      })
      expect(queued[0]?.[4]).toEqual(expect.any(Function))
      expect(
        env.db.raw
          .query<{ count: number }, []>('SELECT COUNT(*) count FROM team_policy_block_events')
          .get()?.count,
      ).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      if (previous === undefined) delete process.env.BAZILION_TEAM_POLICY_ENFORCEMENT
      else process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = previous
    }
  })

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

  test('inbound from a bot account is dropped before any classification', async () => {
    // Another bot posting in a bound agent topic must NOT drive an agent turn.
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: 'hi from another bot', fromIsBot: true })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('ignored_bot')
    expect(sends.length).toBe(0)
  })

  test('ACL: an empty allowlist remains closed until a one-time code is paired', async () => {
    env.db.raw.run('DELETE FROM telegram_allowed_users')
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/help', fromUserId: 7 })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('pairing_required')
    expect(telegramAclRepo.get(env.db, 7)).toBeNull()
    expect(sends[0]?.text).toMatch(/not paired/i)

    const { telegramPairingRepo } = await import('../../src/core/index.ts')
    const challenge = telegramPairingRepo.create(env.db)
    const paired = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      messageUpdate({ threadId: SERVICE_TOPIC, text: `/pair ${challenge.code}`, fromUserId: 7 }),
    )
    expect(paired.kind).toBe('paired_owner')
    expect(telegramAclRepo.get(env.db, 7)?.role).toBe('owner')
  })

  test('ACL: a non-allowlisted user is denied once enforcement is active', async () => {
    // user 11 is the seeded owner; user 99 is not on the list.
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/help', fromUserId: 99 })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('unauthorized')
    if (outcome.kind === 'unauthorized') expect(outcome.userId).toBe(99)
    expect(sends[0]?.text).toMatch(/not authorized/i)
  })

  test('ACL: an allowlisted member passes the gate', async () => {
    telegramAclRepo.add(env.db, { userId: 42, role: 'member' })
    const { api } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/help', fromUserId: 42 })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_command')
  })

  test('migrate_to_chat_id stashes the new chat id and returns chat_migrated', async () => {
    const { api } = makeReplyApi()
    const u: Update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: CHAT_ID, type: 'supergroup', title: 'T' },
        from: { id: 11, is_bot: false, first_name: 'P' },
        migrate_to_chat_id: -1009999999999,
      },
    } as Update
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('chat_migrated')
    if (outcome.kind === 'chat_migrated') expect(outcome.toChatId).toBe(-1009999999999)
    expect(openConfig(env.db).get('TELEGRAM_MIGRATED_CHAT_ID')).toBe('-1009999999999')
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
      teamId: env.teamId,
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
    // The reply confirms creation and includes the "Open topic" URL button.
    expect(sends[0]?.text).toMatch(/Created topic for/)
    const opts = sends[0]?.opts as { reply_markup?: { inline_keyboard?: unknown[][] } }
    expect(opts.reply_markup?.inline_keyboard?.[0]).toBeDefined()
    // And the binding persisted.
    expect(agentRepo.getTelegramTopicId(env.db, agent.id)).not.toBeNull()
  })

  test('/spawn <profile> <name> in <team> spawns into the named team', async () => {
    const { registerTeam } = await import('../../src/core/team/register.ts')
    registerTeam(env.db, { id: 'work', name: 'Work' }, env.paths)
    const { api, creates } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/spawn base teammate in work' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_command')
    const created = agentRepo.list(env.db).find((a) => a.name === 'teammate')
    expect(created?.teamId).toBe('work')
    expect(creates.length).toBe(1)
  })

  test('/spawn into an unknown team is rejected with a hint', async () => {
    const { api, creates } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/spawn base x in nope' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_command')
    expect(creates.length).toBe(0)
    expect(agentRepo.list(env.db).find((a) => a.name === 'x')).toBeUndefined()
  })

  test('agent-topic inbound identifies the agent but sends no reply (step 3 behavior)', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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

  test('callback_query for spawn:profile:<id> stores pending state + edits the picker', async () => {
    const { api, edits, acks } = makeReplyApi()
    const u: Update = {
      update_id: 9000,
      callback_query: {
        id: 'cb1',
        from: { id: 11, is_bot: false, first_name: 'P' },
        chat_instance: 'x',
        message: {
          message_id: 555,
          date: 0,
          chat: { id: CHAT_ID, type: 'supergroup', title: 'T' },
          from: { id: 999, is_bot: true, first_name: 'Bot' },
        } as never,
        data: 'spawn:profile:base',
      } as never,
    }
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('callback_spawn_profile')
    // The picker message gets edited in place with the name prompt.
    expect(edits.length).toBe(1)
    expect(edits[0]?.messageId).toBe(555)
    expect(edits[0]?.text).toMatch(/Reply with a name/)
    // Callback is acked so Telegram's spinner stops.
    expect(acks.length).toBe(1)
    expect(acks[0]?.id).toBe('cb1')
  })

  test('plain text from a user with pending-spawn state completes the spawn', async () => {
    // /spawn always lands new agents in the 'default' team; register it so
    // spawnAgent's fallback resolves.
    const { registerTeam } = await import('../../src/core/team/register.ts')
    registerTeam(env.db, { id: 'default', name: 'Default' }, env.paths)

    // Stash pending state directly (simulating a prior callback_query tap).
    const { setPendingSpawn } = await import('../../src/lib/telegram/spawn-state.ts')
    setPendingSpawn(CHAT_ID, 11, 'base')

    const { api, sends, creates } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: 'orpheus', fromUserId: 11 })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('spawn_name_input')
    if (outcome.kind === 'spawn_name_input') {
      expect(outcome.profileId).toBe('base')
      expect(outcome.spawned).toBe(true)
    }
    // createForumTopic ran (auto-bind after spawn).
    expect(creates.length).toBe(1)
    // Reply is the spawn confirmation with deep-link.
    expect(sends[0]?.text).toMatch(/Spawned/)
    expect(sends[0]?.text).toMatch(/orpheus/)
    // And the new agent is in the DB with the requested name.
    const all = agentRepo.list(env.db)
    const created = all.find((a) => a.name === 'orpheus')
    expect(created).toBeDefined()
  })

  test('callback_query without configured-chat message context is denied', async () => {
    const { api, acks, edits, sends } = makeReplyApi()
    const u: Update = {
      update_id: 1,
      callback_query: {
        id: 'cb2',
        from: { id: 11, is_bot: false, first_name: 'P' },
        chat_instance: 'x',
        data: 'something-else',
      } as never,
    }
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('unauthorized')
    expect(acks.length).toBe(1)
    expect(edits.length).toBe(0)
    expect(sends.length).toBe(0)
  })

  // ─── Step 5: topic-context commands ────────────────────────────────

  test('/close in an agent topic dispatches as a topic command', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/close' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic_command')
    if (outcome.kind === 'agent_topic_command') {
      expect(outcome.name).toBe('close')
      expect(outcome.agentId).toBe(agent.id)
    }
    // Reply explains the topic was closed; sent into the topic.
    expect(sends[0]?.text).toMatch(/Topic closed/)
  })

  test('/unbind clears the topic binding and updates the directory', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/unbind' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic_command')
    expect(agentRepo.getTelegramTopicId(env.db, agent.id)).toBeNull()
  })

  test('/rebind swaps the topic to a different agent when target is unbound', async () => {
    const sourceAgent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'source',
    })
    const targetAgent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'target',
    })
    agentRepo.setTelegramTopicId(env.db, sourceAgent.id, 42)

    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/rebind target' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic_command')
    expect(agentRepo.getTelegramTopicId(env.db, sourceAgent.id)).toBeNull()
    expect(agentRepo.getTelegramTopicId(env.db, targetAgent.id)).toBe(42)
    expect(sends[0]?.text).toMatch(/rebound/)
  })

  test('/rebind refuses when the target agent already has a topic', async () => {
    const sourceAgent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'source',
    })
    const targetAgent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'target',
    })
    agentRepo.setTelegramTopicId(env.db, sourceAgent.id, 42)
    agentRepo.setTelegramTopicId(env.db, targetAgent.id, 99)

    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/rebind target' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic_command')
    // Source still bound to 42; target still bound to 99 — no swap happened.
    expect(agentRepo.getTelegramTopicId(env.db, sourceAgent.id)).toBe(42)
    expect(agentRepo.getTelegramTopicId(env.db, targetAgent.id)).toBe(99)
    expect(sends[0]?.text).toMatch(/already bound/)
  })

  test('/spawn in an agent topic is rejected (wrong surface)', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/spawn base' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    // Service-only command dispatched in topic context → routes as unknown.
    expect(outcome.kind).toBe('agent_topic_unknown_command')
    expect(sends[0]?.text).toMatch(/Unknown command/)
  })

  test('/help in an agent topic returns the topic-contextualized body', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: 42, text: '/help' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('agent_topic_command')
    expect(sends[0]?.text).toContain("You're in")
    expect(sends[0]?.text).toContain('<code>r1</code>')
  })

  test('/close in service chat is rejected (wrong surface)', async () => {
    const { api, sends } = makeReplyApi()
    const u = messageUpdate({ threadId: SERVICE_TOPIC, text: '/close' })
    const outcome = await routeUpdate(
      { db: env.db, paths: env.paths, authToken: 't', api, chatId: CHAT_ID },
      u,
    )
    expect(outcome.kind).toBe('service_unknown_command')
    expect(sends[0]?.text).toMatch(/Unknown command/)
  })
})
