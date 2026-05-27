// One-time first-activation flow. Runs the side effects that turn a freshly-
// configured Telegram supergroup into a usable bazilion control surface:
//
//   1. Find a gear sticker for the service-chat icon (getForumTopicIconStickers).
//   2. createForumTopic('⚙ bazilion', icon_color=red, icon_custom_emoji_id=gear).
//   3. Post + pin the directory welcome message inside the service topic.
//   4. hideGeneralForumTopic.
//
// Each step is independently resumable — intermediate ids land in the config
// table as soon as they exist, so a crash between step 2 and 3 won't recreate
// the topic; the next activation reads the persisted topic id and picks up at
// step 3.
//
// Commands (`setMyCommands`) are intentionally NOT registered in Step 2. The
// menu fills in when Step 3 ships handlers — otherwise the user would see a
// slash menu of broken commands.

import type { Sticker } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig } from '../../core/index.ts'

/** Telegram's 6-color icon enum. Red is reserved for the service chat. */
export const ICON_COLOR_RED = 16478047

/**
 * Minimal Bot API surface the activation flow calls into. Keeps the activation
 * logic testable without spinning up a real grammY Bot.
 */
export interface ActivationApi {
  getForumTopicIconStickers(): Promise<Sticker[]>
  createForumTopic(
    chatId: number,
    name: string,
    opts: { icon_color: number; icon_custom_emoji_id?: string },
  ): Promise<{ message_thread_id: number }>
  sendMessage(
    chatId: number,
    text: string,
    opts: { message_thread_id?: number; parse_mode?: 'HTML' | 'MarkdownV2' },
  ): Promise<{ message_id: number }>
  pinChatMessage(
    chatId: number,
    messageId: number,
    opts?: { disable_notification?: boolean },
  ): Promise<boolean>
  hideGeneralForumTopic(chatId: number): Promise<boolean>
}

export interface ActivationArgs {
  db: BazilionDb
  api: ActivationApi
  chatId: number
}

export interface ActivationResult {
  serviceTopicId: number
  directoryMessageId: number
  gearStickerEmojiId: string | null
  generalHidden: boolean
}

/** The pinned welcome message inside the service topic. Plain text — Step 5 grows it into a live directory with deep-links. */
export const DIRECTORY_WELCOME_MESSAGE = [
  '👋 bazilion is online',
  '',
  'This service chat is where commands will live (next release).',
  'Agent topics will appear in this supergroup as agents become active.',
  '',
  'For now, manage agents from the bazilion web UI.',
].join('\n')

/**
 * Run the activation flow. Idempotent: re-running picks up where a previous
 * run left off based on which ids are already persisted in the config table.
 */
export async function runActivation(args: ActivationArgs): Promise<ActivationResult> {
  const cfg = openConfig(args.db)

  let serviceTopicId = readConfigNumber(args.db, 'TELEGRAM_SERVICE_TOPIC_ID')
  let directoryMessageId = readConfigNumber(args.db, 'TELEGRAM_DIRECTORY_MESSAGE_ID')

  let gearStickerEmojiId: string | null = null
  if (serviceTopicId === null) {
    gearStickerEmojiId = await pickGearSticker(args.api)
    const topic = await args.api.createForumTopic(args.chatId, '⚙ bazilion', {
      icon_color: ICON_COLOR_RED,
      ...(gearStickerEmojiId ? { icon_custom_emoji_id: gearStickerEmojiId } : {}),
    })
    serviceTopicId = topic.message_thread_id
    cfg.set('TELEGRAM_SERVICE_TOPIC_ID', String(serviceTopicId))
  }

  if (directoryMessageId === null) {
    const msg = await args.api.sendMessage(args.chatId, DIRECTORY_WELCOME_MESSAGE, {
      message_thread_id: serviceTopicId,
    })
    directoryMessageId = msg.message_id
    cfg.set('TELEGRAM_DIRECTORY_MESSAGE_ID', String(directoryMessageId))
    // Pin is best-effort — if it fails the directory message still works, it
    // just won't be at the top. We don't want pin failure to re-trigger
    // message creation on the next activation.
    try {
      await args.api.pinChatMessage(args.chatId, directoryMessageId, {
        disable_notification: true,
      })
    } catch (e) {
      console.warn('telegram activation: pinChatMessage failed (continuing):', errMsg(e))
    }
  }

  // hideGeneralForumTopic is idempotent on Telegram's side — calling it on an
  // already-hidden General returns ok=true. Run on every activation so a human
  // who unhides General doesn't permanently change the layout.
  let generalHidden = false
  try {
    generalHidden = await args.api.hideGeneralForumTopic(args.chatId)
  } catch (e) {
    // Some supergroups don't expose hideGeneralForumTopic (e.g. when forum
    // mode was just turned on). Non-fatal.
    console.warn('telegram activation: hideGeneralForumTopic failed (continuing):', errMsg(e))
  }

  return {
    serviceTopicId,
    directoryMessageId,
    gearStickerEmojiId,
    generalHidden,
  }
}

/**
 * Pick a gear sticker from Telegram's curated forum-topic icon set. Telegram
 * returns ~70 stickers with one custom emoji each; we want the one whose
 * emoji is ⚙ (or matches a small set of fallback gear-shaped emojis).
 *
 * Returns the custom_emoji_id to pass to createForumTopic, or null if no
 * suitable sticker is in the set (in which case the topic falls back to
 * color-only).
 */
async function pickGearSticker(api: ActivationApi): Promise<string | null> {
  let stickers: Sticker[] = []
  try {
    stickers = await api.getForumTopicIconStickers()
  } catch (e) {
    console.warn('telegram activation: getForumTopicIconStickers failed (continuing):', errMsg(e))
    return null
  }
  // Preference order — first match wins.
  const GEAR_EMOJIS = ['⚙', '🛠', '⚒', '🔧', '🧰']
  for (const want of GEAR_EMOJIS) {
    const found = stickers.find((s) => (s.emoji ?? '').startsWith(want))
    if (found?.custom_emoji_id) return found.custom_emoji_id
  }
  return null
}

function readConfigNumber(db: BazilionDb, key: string): number | null {
  const raw = openConfig(db).get(key) ?? ''
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
