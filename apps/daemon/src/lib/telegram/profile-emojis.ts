// Forum-topic emoji resolution.
//
// Two layers:
//   1. A curated default emoji per profile *name* (BUILTIN_PROFILE_EMOJI) so a
//      profile called "researcher" gets 📚 with zero config. The default group
//      ("Default") has no entry → color-only.
//   2. A per-agent override (`agents.telegram_icon_emoji`) that wins over the
//      profile default.
//
// The stored value is the emoji CHARACTER (e.g. "📚"), not a Telegram
// custom_emoji_id. We resolve char → custom_emoji_id at topic-creation time
// against Telegram's ~70-sticker forum-icon set (cached after first fetch).
// If the char isn't in the set, resolution returns null → the topic falls back
// to its color-only icon.
//
// The sticker API is provided via a resolver installed by bot.ts at start
// (same lazy pattern as mirror/directory) so this module never statically
// imports bot.ts — avoiding the createForumTopic → topic-autocreate → here →
// bot import cycle.

import type { Agent } from '@bazilion/api-types'
import type { Sticker } from 'grammy/types'

/** Profile-name → default emoji char. Lowercased keys; exact-match lookup. */
export const BUILTIN_PROFILE_EMOJI: Record<string, string> = {
  researcher: '📚',
  coder: '💻',
  developer: '💻',
  engineer: '💻',
  'notes-archivist': '📝',
  archivist: '📝',
  writer: '📝',
  analyst: '📊',
  analytics: '📊',
}

/** Bot API subset needed to fetch the forum-icon sticker set. */
export interface StickerApi {
  getForumTopicIconStickers(): Promise<Sticker[]>
}

let _resolver: (() => StickerApi | null) | null = null
let _stickerMap: Map<string, string> | null = null

export function installStickerApiResolver(resolver: () => StickerApi | null): void {
  _resolver = resolver
}

/**
 * The emoji char to use for an agent, before resolving to a sticker id:
 * per-agent override → profile-name default → null.
 */
export function emojiForAgent(
  agent: Pick<Agent, 'telegramIconEmoji'>,
  profileName: string,
): string | null {
  if (agent.telegramIconEmoji) return agent.telegramIconEmoji
  return BUILTIN_PROFILE_EMOJI[profileName.toLowerCase()] ?? null
}

/**
 * Resolve an emoji char to a Telegram forum-icon `custom_emoji_id`, or null
 * when the char isn't in the set / the bot isn't running. Caches the full set
 * after the first successful fetch (it's global, identical for every bot).
 */
export async function resolveStickerId(emojiChar: string | null): Promise<string | null> {
  if (!emojiChar) return null
  const map = await ensureStickerMap()
  return map?.get(emojiChar) ?? null
}

async function ensureStickerMap(): Promise<Map<string, string> | null> {
  if (_stickerMap) return _stickerMap
  const api = _resolver?.()
  if (!api) return null
  try {
    const stickers = await api.getForumTopicIconStickers()
    const m = new Map<string, string>()
    for (const s of stickers) {
      if (s.emoji && s.custom_emoji_id) m.set(s.emoji, s.custom_emoji_id)
    }
    _stickerMap = m
    return m
  } catch (e) {
    console.warn(
      'telegram: getForumTopicIconStickers failed (icons fall back to color):',
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

/** Test-only — install a resolver + clear the cached map. */
export function _setStickerResolverForTest(resolver: (() => StickerApi | null) | null): void {
  _resolver = resolver
  _stickerMap = null
}
