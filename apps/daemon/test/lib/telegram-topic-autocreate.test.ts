// Topic auto-create primitive tests. Uses a mock TopicCreateApi so no
// network calls are made; verifies persistence, idempotency, and the
// "created vs already-bound" return distinction.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { registerGroup } from '../../src/core/group/register.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import { ensureAgentTopic, type TopicCreateApi } from '../../src/lib/telegram/topic-autocreate.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972

function recordingApi(opts: { nextTopicId?: number; failWith?: string } = {}): {
  api: TopicCreateApi
  calls: { chatId: number; name: string; opts: unknown }[]
} {
  const calls: { chatId: number; name: string; opts: unknown }[] = []
  let next = opts.nextTopicId ?? 100
  const api: TopicCreateApi = {
    async createForumTopic(chatId, name, o) {
      calls.push({ chatId, name, opts: o })
      if (opts.failWith) throw new Error(opts.failWith)
      return { message_thread_id: next++ }
    },
  }
  return { api, calls }
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
})
afterEach(() => env.cleanup())

describe('ensureAgentTopic', () => {
  test('first call creates topic, persists binding, returns created=true', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    const { api, calls } = recordingApi({ nextTopicId: 42 })

    const result = await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: agent.id,
    })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.created).toBe(true)
    expect(result.topicId).toBe(42)
    expect(result.deepLink).toBe('https://t.me/c/3964430972/42/42')
    expect(result.agent.id).toBe(agent.id)

    // Persisted in agents.telegram_topic_id.
    expect(agentRepo.getTelegramTopicId(env.db, agent.id)).toBe(42)
    // Created with the test-group's name as prefix (non-default group).
    expect(calls[0]?.name).toBe('test-group › r1')
  })

  test('second call returns the same topic and does NOT call createForumTopic', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    const { api, calls } = recordingApi({ nextTopicId: 7 })

    await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: agent.id,
    })
    // Reset the recording — second call must not add to it.
    calls.length = 0

    const second = await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: agent.id,
    })
    expect(second.kind).toBe('ok')
    if (second.kind !== 'ok') return
    expect(second.created).toBe(false)
    expect(second.topicId).toBe(7)
    expect(calls.length).toBe(0)
  })

  test('default-group agent gets a bare name (no slug prefix)', async () => {
    registerGroup(env.db, { id: 'default', name: 'default' }, env.paths)
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: 'default',
      name: 'researcher',
    })
    const { api, calls } = recordingApi()

    await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: agent.id,
    })
    expect(calls[0]?.name).toBe('researcher')
  })

  test('returns agent-not-found for an unknown id without calling the API', async () => {
    const { api, calls } = recordingApi()
    const result = await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: 'does-not-exist',
    })
    expect(result.kind).toBe('agent-not-found')
    expect(calls.length).toBe(0)
  })

  test('allocates a group color on first use', async () => {
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    const { api, calls } = recordingApi()
    await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: agent.id,
    })
    // First group → first color in the rotation; opts include icon_color.
    const optsRecord = calls[0]?.opts as { icon_color: number } | undefined
    expect(typeof optsRecord?.icon_color).toBe('number')
  })

  test("subsequent agents in the same group reuse that group's color", async () => {
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'a',
    })
    const b = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'b',
    })
    const { api, calls } = recordingApi()
    await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: a.id,
    })
    await ensureAgentTopic({
      db: env.db,
      paths: env.paths,
      api,
      chatId: CHAT_ID,
      agentId: b.id,
    })
    const colorA = (calls[0]?.opts as { icon_color: number }).icon_color
    const colorB = (calls[1]?.opts as { icon_color: number }).icon_color
    expect(colorA).toBe(colorB)
  })
})
