// Activation flow unit tests. Drives runActivation() against an in-memory
// db + a mock ActivationApi so we can probe persistence behavior + step
// ordering + idempotency without touching grammY or the network.

import type { Sticker } from 'grammy/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openConfig } from '../../src/core/repos/config.ts'
import {
  type ActivationApi,
  DIRECTORY_WELCOME_MESSAGE,
  ICON_COLOR_RED,
  runActivation,
} from '../../src/lib/telegram/activation.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1009999

function gearSticker(id: string): Sticker {
  // Minimal Sticker fields we touch. Cast through unknown to match grammy/types
  // strictness without enumerating every optional field.
  return {
    custom_emoji_id: id,
    emoji: '⚙',
    file_id: `file:${id}`,
    file_unique_id: `uniq:${id}`,
    width: 100,
    height: 100,
    is_animated: false,
    is_video: false,
    type: 'custom_emoji',
  } as unknown as Sticker
}

function nonGearSticker(emoji: string): Sticker {
  return {
    custom_emoji_id: `emoji:${emoji}`,
    emoji,
    file_id: `f:${emoji}`,
    file_unique_id: `u:${emoji}`,
    width: 100,
    height: 100,
    is_animated: false,
    is_video: false,
    type: 'custom_emoji',
  } as unknown as Sticker
}

interface MockOptions {
  stickers?: Sticker[]
  topicId?: number
  messageId?: number
  pinFails?: boolean
  hideFails?: boolean
  stickersFails?: boolean
  commandsFails?: boolean
}

function mockApi(opts: MockOptions = {}): {
  api: ActivationApi
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  const api: ActivationApi = {
    async getForumTopicIconStickers() {
      calls.push({ method: 'getForumTopicIconStickers', args: [] })
      if (opts.stickersFails) throw new Error('stickers boom')
      return opts.stickers ?? [gearSticker('gear-1')]
    },
    async createForumTopic(chatId, name, o) {
      calls.push({ method: 'createForumTopic', args: [chatId, name, o] })
      return { message_thread_id: opts.topicId ?? 555 }
    },
    async sendMessage(chatId, text, o) {
      calls.push({ method: 'sendMessage', args: [chatId, text, o] })
      return { message_id: opts.messageId ?? 7777 }
    },
    async pinChatMessage(chatId, messageId, o) {
      calls.push({ method: 'pinChatMessage', args: [chatId, messageId, o] })
      if (opts.pinFails) throw new Error('pin boom')
      return true
    },
    async hideGeneralForumTopic(chatId) {
      calls.push({ method: 'hideGeneralForumTopic', args: [chatId] })
      if (opts.hideFails) throw new Error('hide boom')
      return true
    },
    async setMyCommands(commands) {
      calls.push({ method: 'setMyCommands', args: [commands] })
      if (opts.commandsFails) throw new Error('commands boom')
      return true
    },
  }
  return { api, calls }
}

describe('runActivation', () => {
  let env: TestEnv

  beforeEach(() => {
    env = makeTestEnv()
    // Quiet the console.warn calls activation emits on swallowed errors so
    // the test output isn't a wall of red.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    env.cleanup()
    vi.restoreAllMocks()
  })

  test('full first activation runs all side effects in order, ending with setMyCommands', async () => {
    const { api, calls } = mockApi({ topicId: 100, messageId: 200 })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })

    expect(result.serviceTopicId).toBe(100)
    expect(result.directoryMessageId).toBe(200)
    expect(result.gearStickerEmojiId).toBe('gear-1')
    expect(result.generalHidden).toBe(true)
    expect(result.commandsRegistered).toBe(true)

    // Calls in order: stickers → createForumTopic → sendMessage → pin → hide → setMyCommands.
    expect(calls.map((c) => c.method)).toEqual([
      'getForumTopicIconStickers',
      'createForumTopic',
      'sendMessage',
      'pinChatMessage',
      'hideGeneralForumTopic',
      'setMyCommands',
    ])

    // createForumTopic gets the red color, the gear id, and the canonical name.
    expect(calls[1]?.args).toEqual([
      CHAT_ID,
      '⚙ bazilion',
      { icon_color: ICON_COLOR_RED, icon_custom_emoji_id: 'gear-1' },
    ])

    // sendMessage is threaded into the new service topic with the welcome body.
    expect(calls[2]?.args).toEqual([CHAT_ID, DIRECTORY_WELCOME_MESSAGE, { message_thread_id: 100 }])

    // Persistence — the two derived ids land in the config table.
    const cfg = openConfig(env.db)
    expect(cfg.get('TELEGRAM_SERVICE_TOPIC_ID')).toBe('100')
    expect(cfg.get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('200')
  })

  test('re-running after full activation skips createForumTopic and sendMessage', async () => {
    // Seed state as if a previous activation completed.
    const cfg = openConfig(env.db)
    cfg.set('TELEGRAM_SERVICE_TOPIC_ID', '42')
    cfg.set('TELEGRAM_DIRECTORY_MESSAGE_ID', '99')

    const { api, calls } = mockApi()
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })

    expect(result.serviceTopicId).toBe(42)
    expect(result.directoryMessageId).toBe(99)
    expect(result.gearStickerEmojiId).toBeNull()
    // No sticker probe, no topic create, no message send, no pin — but hide
    // and setMyCommands still run every activation by design (the latter so
    // command-list changes between releases get picked up on restart).
    expect(calls.map((c) => c.method)).toEqual(['hideGeneralForumTopic', 'setMyCommands'])
  })

  test('resumes from partial state: topic id persisted, message id missing', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '42')

    const { api, calls } = mockApi({ messageId: 88 })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })

    expect(result.serviceTopicId).toBe(42)
    expect(result.directoryMessageId).toBe(88)
    // No sticker / createForumTopic (already done). sendMessage runs against
    // the persisted topic id; pin + hide follow.
    expect(calls.map((c) => c.method)).toEqual([
      'sendMessage',
      'pinChatMessage',
      'hideGeneralForumTopic',
      'setMyCommands',
    ])
    expect(calls[0]?.args).toEqual([CHAT_ID, DIRECTORY_WELCOME_MESSAGE, { message_thread_id: 42 }])
  })

  test('pin failure is swallowed but the directory message id still persists', async () => {
    const { api } = mockApi({ pinFails: true, messageId: 555 })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })

    expect(result.directoryMessageId).toBe(555)
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('555')
  })

  test('hideGeneralForumTopic failure is swallowed; result reflects it', async () => {
    const { api } = mockApi({ hideFails: true })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    expect(result.generalHidden).toBe(false)
  })

  test('getForumTopicIconStickers failure falls back to color-only', async () => {
    const { api, calls } = mockApi({ stickersFails: true })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    expect(result.gearStickerEmojiId).toBeNull()
    // createForumTopic should be called WITHOUT icon_custom_emoji_id.
    const create = calls.find((c) => c.method === 'createForumTopic')
    expect(create?.args[2]).toEqual({ icon_color: ICON_COLOR_RED })
  })

  test('gear sticker picker prefers ⚙ over fallbacks', async () => {
    const set = [
      nonGearSticker('🛠'), // fallback
      gearSticker('the-gear'),
      nonGearSticker('🔧'),
    ]
    const { api } = mockApi({ stickers: set })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    expect(result.gearStickerEmojiId).toBe('the-gear')
  })

  test('gear sticker picker uses fallback emojis when ⚙ missing', async () => {
    const set = [nonGearSticker('🦄'), nonGearSticker('🛠'), nonGearSticker('🐱')]
    const { api } = mockApi({ stickers: set })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    expect(result.gearStickerEmojiId).toBe('emoji:🛠')
  })

  test('gear sticker picker returns null when no gear-shaped sticker exists', async () => {
    const set = [nonGearSticker('🦄'), nonGearSticker('🐱'), nonGearSticker('🚀')]
    const { api } = mockApi({ stickers: set })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    expect(result.gearStickerEmojiId).toBeNull()
  })

  test('createForumTopic failure propagates (no partial persistence)', async () => {
    const failingApi: ActivationApi = {
      ...mockApi().api,
      createForumTopic: async () => {
        throw new Error('forbidden')
      },
    }
    await expect(runActivation({ db: env.db, api: failingApi, chatId: CHAT_ID })).rejects.toThrow(
      'forbidden',
    )
    // Nothing persisted because the failure was before any successful step.
    expect(openConfig(env.db).get('TELEGRAM_SERVICE_TOPIC_ID')).toBeUndefined()
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBeUndefined()
  })

  test('setMyCommands failure is swallowed; result.commandsRegistered=false', async () => {
    const { api } = mockApi({ commandsFails: true })
    const result = await runActivation({ db: env.db, api, chatId: CHAT_ID })
    // The earlier steps still complete normally.
    expect(result.serviceTopicId).toBeGreaterThan(0)
    expect(result.commandsRegistered).toBe(false)
  })
})
