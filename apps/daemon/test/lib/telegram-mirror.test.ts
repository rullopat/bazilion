// Mirror module tests — frame → Telegram message rendering across both
// modes, no-ops when the agent is unbound / bot is down, lazy-reconcile on
// "thread not found".

import type { ChatFrame } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import {
  _resetMirrorDepsForTest,
  installMirrorDepsResolver,
  type MirrorApi,
  mirrorAgentTurnFrame,
} from '../../src/lib/telegram/mirror.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972

function makeApi(opts: { failWith?: string; photoFailWith?: string } = {}): {
  api: MirrorApi
  sends: { chatId: number; text: string; opts: unknown }[]
  typings: { chatId: number; action: string; opts: unknown }[]
  photos: { chatId: number; opts: unknown }[]
  documents: { chatId: number; opts: unknown }[]
} {
  const sends: { chatId: number; text: string; opts: unknown }[] = []
  const typings: { chatId: number; action: string; opts: unknown }[] = []
  const photos: { chatId: number; opts: unknown }[] = []
  const documents: { chatId: number; opts: unknown }[] = []
  const api: MirrorApi = {
    async sendMessage(chatId, text, o) {
      sends.push({ chatId, text, opts: o })
      if (opts.failWith) throw new Error(opts.failWith)
      return { message_id: 1 }
    },
    async sendChatAction(chatId, action, o) {
      typings.push({ chatId, action, opts: o })
      return true
    },
    async sendPhoto(chatId, _photo, o) {
      if (opts.photoFailWith) throw new Error(opts.photoFailWith)
      photos.push({ chatId, opts: o })
      return { message_id: 2 }
    },
    async sendDocument(chatId, _document, o) {
      documents.push({ chatId, opts: o })
      return { message_id: 3 }
    },
  }
  return { api, sends, typings, photos, documents }
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  _resetMirrorDepsForTest()
  _resetOutboundQueueForTest()
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
  // Quiet expected warnings on the "thread gone" path.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  env.cleanup()
  vi.restoreAllMocks()
  _resetMirrorDepsForTest()
  _resetOutboundQueueForTest()
})

function frameEvent(event: ChatFrame & { kind: 'event' }): ChatFrame {
  return event
}

describe('mirrorAgentTurnFrame', () => {
  test('no-op when bot/mirror deps not installed', async () => {
    // No installMirrorDepsResolver call — resolver returns null.
    await mirrorAgentTurnFrame('any-id', {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hi' },
    })
    // No exception thrown — nothing to assert beyond that.
  })

  test('no-op when agent has no bound topic', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hello' },
    })
    expect(sends.length).toBe(0)
  })

  test('minimal mode: assistant_message is sent into the bound topic', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hello world' },
    })
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toBe('hello world')
    expect((sends[0]?.opts as { message_thread_id?: number }).message_thread_id).toBe(42)
  })

  test('minimal mode: tool_call / tool_result do NOT mirror', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    // Default mode is 'minimal' — tool_call drops.

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'tool_call', id: '1', name: 'read_file', arguments: '{"path":"x"}' },
    })
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'tool_result', id: '1', name: 'read_file', result: 'contents' },
    })
    expect(sends.length).toBe(0)
  })

  test('minimal mode: a tool_result image IS sent as a photo (deliverable, not noise)', async () => {
    const { api, sends, photos } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', groupId: env.groupId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: '1',
        name: 'browser_take_screenshot',
        result: 'Screenshot of https://example.com',
        images: [{ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
      },
    })
    // Photo sent into the topic with the result as caption; no text message.
    expect(photos.length).toBe(1)
    expect((photos[0]?.opts as { message_thread_id?: number }).message_thread_id).toBe(42)
    expect((photos[0]?.opts as { caption?: string }).caption).toBe(
      'Screenshot of https://example.com',
    )
    expect(sends.length).toBe(0)
  })

  test('image send falls back to a document when the photo is rejected', async () => {
    const { api, photos, documents } = makeApi({ photoFailWith: 'IMAGE_PROCESS_FAILED' })
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', groupId: env.groupId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: '1',
        name: 'browser_take_screenshot',
        result: 'Screenshot',
        images: [{ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
      },
    })
    expect(photos.length).toBe(0)
    expect(documents.length).toBe(1)
  })

  test('verbose mode: tool_call and tool_result are rendered as summary lines', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    agentRepo.setTelegramMirrorMode(env.db, a.id, 'verbose')

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'tool_call', id: '1', name: 'read_file', arguments: '{"path":"foo.ts"}' },
    })
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toMatch(/🔧 read_file/)
    expect(sends[0]?.text).toMatch(/path=foo\.ts/)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'tool_result', id: '1', name: 'read_file', result: 'file contents' },
    })
    expect(sends.length).toBe(2)
    expect(sends[1]?.text).toMatch(/✓ read_file/)
    expect(sends[1]?.text).toMatch(/file contents/)
  })

  test('error events are always mirrored (both modes)', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    // minimal mode by default — error still mirrors.

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'error', error: 'provider down' },
    })
    expect(sends[0]?.text).toMatch(/❌ Error/)
    expect(sends[0]?.text).toMatch(/provider down/)
  })

  test('fatal frames are mirrored as crash markers', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, { kind: 'fatal', error: 'worker crashed' })
    expect(sends[0]?.text).toMatch(/💥 Turn crashed/)
    expect(sends[0]?.text).toMatch(/worker crashed/)
  })

  test('done frames never mirror', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    await mirrorAgentTurnFrame(a.id, { kind: 'done', messages: [] })
    expect(sends.length).toBe(0)
  })

  test('assistant_delta and user_message do not mirror', async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_delta', delta: 'partial' },
    })
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'user_message', text: 'hi' },
    })
    expect(sends.length).toBe(0)
  })

  test('"message thread not found" clears the binding (lazy reconcile)', async () => {
    const { api } = makeApi({ failWith: 'Bad Request: message thread not found' })
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hello' },
    })
    // Binding cleared so future mirrors no-op.
    expect(agentRepo.getTelegramTopicId(env.db, a.id)).toBeNull()
  })

  test("long messages are truncated under Telegram's 4096 char limit", async () => {
    const { api, sends } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    const long = 'x'.repeat(5000)
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: long },
    })
    expect(sends.length).toBe(1)
    expect((sends[0]?.text ?? '').length).toBeLessThanOrEqual(4096)
  })
})

describe('mirrorTypingStart / mirrorTypingStop', () => {
  test('start fires sendChatAction immediately + re-fires on interval; stop clears', async () => {
    const { mirrorTypingStart, mirrorTypingStop } = await import('../../src/lib/telegram/mirror.ts')
    const { api, typings } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    // Use fake timers so we can advance through the 4s re-fire interval.
    vi.useFakeTimers()
    try {
      mirrorTypingStart(a.id)
      // Immediate first fire.
      expect(typings.length).toBe(1)
      expect(typings[0]?.action).toBe('typing')
      expect((typings[0]?.opts as { message_thread_id?: number }).message_thread_id).toBe(42)

      // Advance ~5s — second fire lands.
      await vi.advanceTimersByTimeAsync(4_500)
      expect(typings.length).toBe(2)

      // Stop — no more fires even after another interval passes.
      mirrorTypingStop(a.id)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(typings.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('start is a no-op when agent has no bound topic', async () => {
    const { mirrorTypingStart } = await import('../../src/lib/telegram/mirror.ts')
    const { api, typings } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    // No setTelegramTopicId — agent is unbound.

    mirrorTypingStart(a.id)
    expect(typings.length).toBe(0)
  })

  test('start twice for the same agent clears the prior interval (no timer leak)', async () => {
    const { mirrorTypingStart, mirrorTypingStop } = await import('../../src/lib/telegram/mirror.ts')
    const { api, typings } = makeApi()
    installMirrorDepsResolver(() => ({ db: env.db, api, chatId: CHAT_ID }))
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: env.groupId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    vi.useFakeTimers()
    try {
      mirrorTypingStart(a.id)
      // Second start replaces the interval, doesn't stack a second timer.
      mirrorTypingStart(a.id)
      // Two immediate fires from the two start calls.
      expect(typings.length).toBe(2)
      // After 4.5s only ONE more fire (one interval running, not two).
      await vi.advanceTimersByTimeAsync(4_500)
      expect(typings.length).toBe(3)
      mirrorTypingStop(a.id)
    } finally {
      vi.useRealTimers()
    }
  })
})
