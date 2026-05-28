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

import type { BotCommand, Sticker } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { openConfig } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { SERVICE_COMMANDS } from './commands/index.ts'
import { buildDirectoryBody, refreshDirectoryNow } from './directory.ts'

/** Telegram's 6-color icon enum. Red is reserved for the service chat. */
export const ICON_COLOR_RED = 16478047

/**
 * Minimal Bot API surface the activation flow calls into. Keeps the activation
 * logic testable without spinning up a real grammY Bot. Activation also
 * delegates to `refreshDirectoryNow` for post-activation directory sync, so
 * this surface includes `editMessageText` (used by the directory's
 * recreate-on-delete path).
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
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts: { parse_mode?: 'HTML' | 'MarkdownV2'; disable_web_page_preview?: boolean },
  ): Promise<unknown>
  pinChatMessage(
    chatId: number,
    messageId: number,
    opts?: { disable_notification?: boolean },
  ): Promise<boolean>
  hideGeneralForumTopic(chatId: number): Promise<boolean>
  /**
   * Register the service-chat command list with Telegram. Failures are
   * non-fatal — the slash menu just stays empty until the next activation.
   */
  setMyCommands(commands: BotCommand[]): Promise<boolean>
}

export interface ActivationArgs {
  db: BazilionDb
  paths: Paths
  api: ActivationApi
  chatId: number
}

export interface ActivationResult {
  serviceTopicId: number
  directoryMessageId: number
  gearStickerEmojiId: string | null
  generalHidden: boolean
  commandsRegistered: boolean
}

/**
 * @deprecated Kept for backward-compat with tests; live activation now uses
 * `buildDirectoryBody` from directory.ts which produces a dynamic agent
 * listing (with deep-links) rather than a static welcome banner.
 */
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
  // Track whether the directory message already existed at activation entry.
  // First-time creation already writes the dynamic body — re-running refresh
  // after that would be a redundant editMessageText call.
  const directoryAlreadyExisted = directoryMessageId !== null
  // First activation = service topic doesn't exist yet. Used to gate the
  // one-time-only General hide below.
  const firstActivation = serviceTopicId === null

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
    // Initial creation — render the dynamic directory body (agents grouped
    // by group, deep-links for the bound ones, empty-state hint otherwise).
    const body = buildDirectoryBody(args.db, args.paths, args.chatId)
    const msg = await args.api.sendMessage(args.chatId, body, {
      message_thread_id: serviceTopicId,
      parse_mode: 'HTML',
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

  // Hide General ONLY on first activation. Telegram's hideGeneralForumTopic
  // auto-closes the General topic if it's open, which posts a "closed the
  // topic" service message. Running it on every activation (bot start, stall
  // restart, etc.) spams that message on each restart — so we hide once, at
  // initial setup, and leave it alone afterward. A human who deliberately
  // unhides General keeps it (we no longer fight them on every restart).
  let generalHidden = false
  if (firstActivation) {
    try {
      generalHidden = await args.api.hideGeneralForumTopic(args.chatId)
    } catch (e) {
      // Some supergroups don't expose hideGeneralForumTopic (e.g. when forum
      // mode was just turned on). Non-fatal.
      console.warn('telegram activation: hideGeneralForumTopic failed (continuing):', errMsg(e))
    }
  }

  // Register the slash-command menu. Re-running every activation keeps the
  // menu in sync if SERVICE_COMMANDS evolves between releases.
  let commandsRegistered = false
  try {
    commandsRegistered = await args.api.setMyCommands(
      SERVICE_COMMANDS.map((c) => ({ command: c.name, description: c.description })),
    )
  } catch (e) {
    console.warn('telegram activation: setMyCommands failed (continuing):', errMsg(e))
  }

  // Re-activation sync — if the directory message already existed but the
  // agent table changed while the daemon was down, push the latest body.
  // Skipped on first-time creation: the initial sendMessage above already
  // wrote the dynamic body, so a redundant editMessageText would just hit
  // "message is not modified".
  if (directoryAlreadyExisted) {
    try {
      await refreshDirectoryNow({
        db: args.db,
        paths: args.paths,
        // ActivationApi has the superset of editMessageText + pinChatMessage
        // we need for DirectoryApi — cast is safe because grammY's Bot.api
        // implements both interfaces.
        api: args.api as unknown as Parameters<typeof refreshDirectoryNow>[0]['api'],
        chatId: args.chatId,
      })
    } catch (e) {
      console.warn('telegram activation: post-activation directory refresh failed:', errMsg(e))
    }
  }

  return {
    serviceTopicId,
    directoryMessageId,
    gearStickerEmojiId,
    generalHidden,
    commandsRegistered,
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
