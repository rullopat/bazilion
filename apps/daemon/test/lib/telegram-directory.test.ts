// Directory module tests — body building, refresh path, recreate-on-delete.

import type { InlineKeyboardMarkup } from 'grammy/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { registerGroup } from '../../src/core/group/register.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import * as agentRepo from '../../src/core/repos/agents.ts'
import { openConfig } from '../../src/core/repos/config.ts'
import {
  _resetDirectoryStateForTest,
  buildDirectoryBody,
  type DirectoryApi,
  refreshDirectoryNow,
} from '../../src/lib/telegram/directory.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const CHAT_ID = -1003964430972

interface Recorded {
  sends: { chatId: number; text: string; opts: unknown }[]
  edits: { chatId: number; messageId: number; text: string }[]
  pins: { chatId: number; messageId: number }[]
  editsToThrow?: 'gone' | 'not-modified' | 'other'
}

function makeApi(opts: { editFails?: 'gone' | 'not-modified' | 'other' } = {}): {
  api: DirectoryApi
  recorded: Recorded
} {
  const recorded: Recorded = {
    sends: [],
    edits: [],
    pins: [],
    ...(opts.editFails ? { editsToThrow: opts.editFails } : {}),
  }
  let nextMessageId = 500
  const api: DirectoryApi = {
    async sendMessage(chatId, text, o) {
      recorded.sends.push({ chatId, text, opts: o })
      return { message_id: nextMessageId++ }
    },
    async editMessageText(chatId, messageId, text) {
      recorded.edits.push({ chatId, messageId, text })
      if (opts.editFails === 'gone') {
        throw new Error('Bad Request: message to edit not found')
      }
      if (opts.editFails === 'not-modified') {
        throw new Error('Bad Request: message is not modified')
      }
      if (opts.editFails === 'other') {
        throw new Error('boom')
      }
      return true
    },
    async pinChatMessage(chatId, messageId) {
      recorded.pins.push({ chatId, messageId })
      return true
    },
  }
  return { api, recorded }
}

let env: TestEnv
beforeEach(() => {
  env = makeTestEnv()
  _resetDirectoryStateForTest()
  // Seed prerequisites so spawnAgent works.
  registerGroup(env.db, { id: 'default', name: 'Default' }, env.paths)
  createProfile(env.db, env.paths, {
    id: 'base',
    defaultModel: 'anthropic:claude-opus-4-6',
    defaultSkills: [],
  })
  // Suppress noisy warnings emitted on the deliberate failure paths.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  env.cleanup()
  vi.restoreAllMocks()
  _resetDirectoryStateForTest()
})

describe('buildDirectoryBody', () => {
  test('empty install renders the "no agents yet" hint', () => {
    const body = buildDirectoryBody(env.db, env.paths, CHAT_ID)
    expect(body).toContain('No agents yet')
    expect(body).toContain('/spawn')
  })

  test('lists agents grouped by group, with deep-link for bound ones', () => {
    const bound = spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: 'default',
      name: 'researcher',
    })
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: 'default',
      name: 'wandering',
    })
    agentRepo.setTelegramTopicId(env.db, bound.id, 42)

    const body = buildDirectoryBody(env.db, env.paths, CHAT_ID)

    expect(body).toContain('Available agents')
    expect(body).toContain('<b>default</b>')
    expect(body).toContain('<code>researcher</code>')
    expect(body).toContain('<code>wandering</code>')
    expect(body).toMatch(/<a href="https:\/\/t\.me\/c\/3964430972\/42">open<\/a>/)
    expect(body).toContain('(unbound)')
  })

  test('excludes groups with no non-archived agents', () => {
    registerGroup(env.db, { id: 'g2', name: 'g2' }, env.paths)
    spawnAgent(env.db, env.paths, {
      profileId: 'base',
      groupId: 'default',
      name: 'only-one',
    })
    const body = buildDirectoryBody(env.db, env.paths, CHAT_ID)
    expect(body).toContain('<b>default</b>')
    // g2 has no agents — skipped.
    expect(body).not.toContain('<b>g2</b>')
  })
})

describe('refreshDirectoryNow', () => {
  test('no-op when service topic id is not set', async () => {
    const { api, recorded } = makeApi()
    await refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID })
    expect(recorded.sends.length).toBe(0)
    expect(recorded.edits.length).toBe(0)
  })

  test('creates the directory message on first refresh when none is stored', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '11')
    const { api, recorded } = makeApi()
    await refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID })
    expect(recorded.sends.length).toBe(1)
    expect(recorded.pins.length).toBe(1)
    // Persisted the new directory message id.
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('500')
  })

  test('edits the existing directory message when id is stored', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '11')
    openConfig(env.db).set('TELEGRAM_DIRECTORY_MESSAGE_ID', '88')
    const { api, recorded } = makeApi()
    await refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID })
    expect(recorded.edits.length).toBe(1)
    expect(recorded.edits[0]?.messageId).toBe(88)
    expect(recorded.sends.length).toBe(0)
    // Existing id preserved.
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('88')
  })

  test('recreates the directory message when Telegram says it is gone', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '11')
    openConfig(env.db).set('TELEGRAM_DIRECTORY_MESSAGE_ID', '88')
    const { api, recorded } = makeApi({ editFails: 'gone' })

    await refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID })

    // Tried to edit, fell through to send + pin.
    expect(recorded.edits.length).toBe(1)
    expect(recorded.sends.length).toBe(1)
    expect(recorded.pins.length).toBe(1)
    // Stored id updated to the new message.
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('500')
  })

  test('"message is not modified" is swallowed silently', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '11')
    openConfig(env.db).set('TELEGRAM_DIRECTORY_MESSAGE_ID', '88')
    const { api, recorded } = makeApi({ editFails: 'not-modified' })

    await refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID })

    // Edit was attempted, no recreate.
    expect(recorded.edits.length).toBe(1)
    expect(recorded.sends.length).toBe(0)
    expect(openConfig(env.db).get('TELEGRAM_DIRECTORY_MESSAGE_ID')).toBe('88')
  })

  test('non-"gone" edit errors propagate (so callers can log them loud)', async () => {
    openConfig(env.db).set('TELEGRAM_SERVICE_TOPIC_ID', '11')
    openConfig(env.db).set('TELEGRAM_DIRECTORY_MESSAGE_ID', '88')
    const { api } = makeApi({ editFails: 'other' })
    await expect(
      refreshDirectoryNow({ db: env.db, paths: env.paths, api, chatId: CHAT_ID }),
    ).rejects.toThrow('boom')
  })
})
