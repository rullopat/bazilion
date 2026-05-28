// Profile-derived topic emoji resolution: lookup order + sticker resolution
// via the installed resolver.

import type { Sticker } from 'grammy/types'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  _setStickerResolverForTest,
  BUILTIN_PROFILE_EMOJI,
  emojiForAgent,
  resolveStickerId,
} from '../../src/lib/telegram/profile-emojis.ts'

afterEach(() => _setStickerResolverForTest(null))

describe('emojiForAgent (lookup order)', () => {
  test('per-agent override wins over the profile-name default', () => {
    expect(emojiForAgent({ telegramIconEmoji: '🦊' }, 'researcher')).toBe('🦊')
  })

  test('falls back to the profile-name default (case-insensitive)', () => {
    expect(emojiForAgent({ telegramIconEmoji: null }, 'Researcher')).toBe(
      BUILTIN_PROFILE_EMOJI.researcher,
    )
  })

  test('unknown profile name with no override → null (color-only)', () => {
    expect(emojiForAgent({ telegramIconEmoji: null }, 'Default')).toBeNull()
  })
})

describe('resolveStickerId', () => {
  const stickers: Sticker[] = [
    { emoji: '📚', custom_emoji_id: 'cid-books' } as Sticker,
    { emoji: '💻', custom_emoji_id: 'cid-laptop' } as Sticker,
  ]

  beforeEach(() => {
    _setStickerResolverForTest(() => ({
      async getForumTopicIconStickers() {
        return stickers
      },
    }))
  })

  test('maps an emoji char to its custom_emoji_id', async () => {
    expect(await resolveStickerId('📚')).toBe('cid-books')
  })

  test('returns null for a char not in the set', async () => {
    expect(await resolveStickerId('🦊')).toBeNull()
  })

  test('returns null for a null char', async () => {
    expect(await resolveStickerId(null)).toBeNull()
  })

  test('returns null when no resolver/bot is available', async () => {
    _setStickerResolverForTest(() => null)
    expect(await resolveStickerId('📚')).toBeNull()
  })
})
