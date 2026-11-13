// Mirror module tests — frame → Telegram message rendering across both
// modes, no-ops when the agent is unbound / bot is down, lazy-reconcile on
// "thread not found".

import type { Api, InputFile } from 'grammy'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import * as results from '../../src/core/repos/results.ts'
import { questionRegistry } from '../../src/lib/questions.ts'
import { setTelegramLive } from '../../src/lib/telegram/live.ts'
import { _resetMirrorForTest, mirrorAgentTurnFrame } from '../../src/lib/telegram/mirror.ts'
import { _resetOutboundQueueForTest } from '../../src/lib/telegram/outbound-queue.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972

/** The Bot API calls the mirror makes. */
interface MirrorApi {
  sendMessage(chatId: number, text: string, opts: unknown): Promise<{ message_id: number }>
  sendChatAction(chatId: number, action: string, opts: unknown): Promise<boolean>
  sendPhoto(chatId: number, photo: InputFile, opts: unknown): Promise<{ message_id: number }>
  sendDocument(chatId: number, document: InputFile, opts: unknown): Promise<{ message_id: number }>
}

function useLive(api: MirrorApi): void {
  setTelegramLive({
    api: api as unknown as Api,
    chatId: CHAT_ID,
    db: env.db,
    paths: env.paths,
  })
}

function makeApi(
  opts: { failWith?: string; photoFailWith?: string; documentFailWith?: string } = {},
): {
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
      if (opts.documentFailWith) throw new Error(opts.documentFailWith)
      documents.push({ chatId, opts: o })
      return { message_id: 3 }
    },
  }
  return { api, sends, typings, photos, documents }
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  _resetMirrorForTest()
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
  setTelegramLive(null)
  _resetMirrorForTest()
  _resetOutboundQueueForTest()
})

describe('mirrorAgentTurnFrame', () => {
  test('no-op when bot/mirror deps not installed', async () => {
    // No live bot.
    await mirrorAgentTurnFrame('any-id', {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hi' },
    })
    // No exception thrown — nothing to assert beyond that.
  })

  test('no-op when agent has no bound topic', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: 'hello' },
    })
    expect(sends.length).toBe(0)
  })

  test('nothing is sent once the bot has stopped', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    setTelegramLive(null)
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: 'after disconnect' },
    })
    expect(sends).toEqual([])
  })

  test('a question goes to the topic with its buttons in minimal mode', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    const turn = new AbortController()
    const { question } = questionRegistry.ask(
      { agentId: a.id, conversationId: crypto.randomUUID() },
      { prompt: 'Which one?', choices: [{ label: 'A' }, { label: 'B' }] },
      turn.signal,
    )
    try {
      await mirrorAgentTurnFrame(a.id, {
        kind: 'event',
        event: { type: 'agent_question', question },
      })
      expect(sends).toHaveLength(1)
      expect(sends[0]?.text).toContain('Which one?')
      expect(sends[0]?.opts).toMatchObject({ message_thread_id: 42, reply_markup: {} })
    } finally {
      turn.abort()
    }
  })

  test('minimal mode: assistant_message is sent into the bound topic', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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

  test('assistant_message Markdown is converted to Telegram HTML with parse_mode', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: '# Title\n\n**bold** and `code`' },
    })
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toBe('▎ <b>Title</b>\n\n<b>bold</b> and <code>code</code>')
    expect((sends[0]?.opts as { parse_mode?: string }).parse_mode).toBe('HTML')
  })

  test('errors/tool lines are NOT HTML — sent as plain text, no parse_mode', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'error', error: 'boom <not a tag>' },
    })
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toBe('❌ Error: boom <not a tag>')
    expect((sends[0]?.opts as { parse_mode?: string }).parse_mode).toBeUndefined()
  })

  test('a parse-entities rejection falls back to plain text (reply never dropped)', async () => {
    const sends: { text: string; opts: unknown }[] = []
    let calls = 0
    const api: MirrorApi = {
      async sendMessage(_chatId, text, opts) {
        calls++
        // First attempt (HTML) is rejected the way Telegram rejects bad markup.
        if (calls === 1) throw new Error("Bad Request: can't parse entities")
        sends.push({ text, opts })
        return { message_id: 1 }
      },
      async sendChatAction() {
        return true
      },
      async sendPhoto() {
        return { message_id: 2 }
      },
      async sendDocument() {
        return { message_id: 3 }
      },
    }
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: '**hi** there' },
    })
    // Two calls: failed HTML attempt + plain-text retry (tags stripped, no parse_mode).
    expect(calls).toBe(2)
    expect(sends.length).toBe(1)
    expect(sends[0]?.text).toBe('hi there')
    expect((sends[0]?.opts as { parse_mode?: string }).parse_mode).toBeUndefined()
  })

  test('minimal mode: tool_call / tool_result do NOT mirror', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
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

  test('photo caption is the first non-empty line of the tool result', async () => {
    const { api, photos } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: '1',
        name: 'browser_take_screenshot',
        result: 'Screenshot of https://example.com\nextra line\nmore detail',
        images: [{ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
      },
    })
    expect((photos[0]?.opts as { caption?: string }).caption).toBe(
      'Screenshot of https://example.com',
    )
  })

  test('a delivered file (deliver_file) is sent as a Telegram document', async () => {
    const { api, documents, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    const saved = results.publish(env.db, {
      teamId: env.teamId,
      agentId: a.id,
      sessionId: 'session',
      toolCallId: 'call',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7'),
    })
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: {
        type: 'file',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        result: { resultId: saved.id },
      },
    })
    expect(documents.length).toBe(1)
    expect((documents[0]?.opts as { caption?: string }).caption).toBe('report.pdf')
    expect((documents[0]?.opts as { message_thread_id?: number }).message_thread_id).toBe(42)
    expect(sends.length).toBe(0)
  })

  test('image send falls back to a document when the photo is rejected', async () => {
    const { api, photos, documents } = makeApi({ photoFailWith: 'IMAGE_PROCESS_FAILED' })
    useLive(api)
    const a = spawnAgent(env.db, env.paths, { profileId: 'base', teamId: env.teamId, name: 'r1' })
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

  test('adapter failures never log a Telegram bot token', async () => {
    const sentinel = '123456789:AA_TelegramBotTokenSentinel'
    const adapterError = `request failed: https://api.telegram.org/bot${sentinel}/sendMessage`
    const { api } = makeApi({
      failWith: `can't parse entities; ${adapterError}`,
      photoFailWith: adapterError,
      documentFailWith: adapterError,
    })
    useLive(api)
    const agent = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, agent.id, 42)

    await mirrorAgentTurnFrame(agent.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: '**reply**' },
    })
    await mirrorAgentTurnFrame(agent.id, {
      kind: 'event',
      event: {
        type: 'tool_result',
        id: '1',
        name: 'image',
        result: 'image',
        images: [{ data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
      },
    })
    const saved = results.publish(env.db, {
      teamId: env.teamId,
      agentId: agent.id,
      sessionId: 'session',
      toolCallId: 'call',
      name: 'report.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('report'),
    })
    await mirrorAgentTurnFrame(agent.id, {
      kind: 'event',
      event: {
        type: 'file',
        name: 'report.txt',
        mimeType: 'text/plain',
        result: { resultId: saved.id },
      },
    })

    const warnings = JSON.stringify(vi.mocked(console.warn).mock.calls)
    expect(warnings).not.toContain(sentinel)
    expect(warnings).not.toContain('api.telegram.org')
    expect(warnings).toContain('telegram_adapter_failed')
  })

  test('verbose mode: tool_call and tool_result are rendered as summary lines', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    await mirrorAgentTurnFrame(a.id, { kind: 'fatal', error: 'worker crashed' })
    expect(sends[0]?.text).toMatch(/💥 Turn crashed/)
    expect(sends[0]?.text).toMatch(/worker crashed/)
  })

  test('done frames never mirror', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)
    await mirrorAgentTurnFrame(a.id, { kind: 'done', messages: [] })
    expect(sends.length).toBe(0)
  })

  test('assistant_delta and user_message do not mirror', async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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

  test("long replies are split into multiple messages under Telegram's 4096 limit", async () => {
    const { api, sends } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    agentRepo.setTelegramTopicId(env.db, a.id, 42)

    const long = 'x'.repeat(5000)
    await mirrorAgentTurnFrame(a.id, {
      kind: 'event',
      event: { type: 'assistant_message', text: long },
    })
    // Split across multiple sends rather than truncated; every chunk fits and
    // no content is lost.
    expect(sends.length).toBeGreaterThan(1)
    for (const s of sends) expect(s.text.length).toBeLessThanOrEqual(4096)
    expect(sends.map((s) => s.text).join('')).toBe(long)
  })
})

describe('mirrorTypingStart / mirrorTypingStop', () => {
  test('start fires sendChatAction immediately + re-fires on interval; stop clears', async () => {
    const { mirrorTypingStart, mirrorTypingStop } = await import('../../src/lib/telegram/mirror.ts')
    const { api, typings } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
      name: 'r1',
    })
    // No setTelegramTopicId — agent is unbound.

    mirrorTypingStart(a.id)
    expect(typings.length).toBe(0)
  })

  test('start twice for the same agent clears the prior interval (no timer leak)', async () => {
    const { mirrorTypingStart, mirrorTypingStop } = await import('../../src/lib/telegram/mirror.ts')
    const { api, typings } = makeApi()
    useLive(api)
    const a = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      teamId: env.teamId,
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
