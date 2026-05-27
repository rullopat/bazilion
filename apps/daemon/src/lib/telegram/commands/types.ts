// Shared shapes for the service-chat command surface. Every command's handle
// function takes a CommandCtx and returns a CommandResult — the router posts
// the result back into the service topic.

import type { InlineKeyboardMarkup, User } from 'grammy/types'
import type { BazilionDb } from '../../../core/db/client.ts'
import type { Paths } from '../../../core/paths.ts'
import type { TopicCreateApi } from '../topic-autocreate.ts'

/**
 * Narrow Bot API subset commands may call. `TopicCreateApi` is the only
 * mutating call we make in Step 3 (`/talk` creating a forum topic).
 * Future commands grow this interface; per-command tests stay easy because
 * each handler only sees the methods it needs.
 */
export type CommandApi = TopicCreateApi

export interface CommandCtx {
  db: BazilionDb
  paths: Paths
  /** Daemon auth token — for the same secrets / config plumbing routes use. */
  authToken: string
  api: CommandApi
  /** Supergroup chat id where the command was issued. */
  chatId: number
  /** Sender of the message containing the command. */
  from: User
  /** Everything after the command word — trimmed, may be empty. */
  args: string
}

export interface CommandResult {
  text: string
  parseMode?: 'HTML' | 'MarkdownV2'
  disableWebPagePreview?: boolean
  /**
   * Inline-keyboard markup (`/spawn`'s profile picker). Plumbed through to
   * Telegram's `sendMessage(reply_markup: ...)`. Most commands leave it
   * undefined — only ones that need callback_query follow-ups set it.
   */
  replyMarkup?: InlineKeyboardMarkup
}

export type CommandHandler = (ctx: CommandCtx) => Promise<CommandResult>

export interface CommandDescriptor {
  /** The command word without leading slash. e.g. "talk". */
  name: string
  /** Telegram's setMyCommands description (≤ 256 chars). */
  description: string
  handle: CommandHandler
  /** Optional aliases — secondary command words that route to the same handler but don't appear in the slash menu. */
  aliases?: readonly string[]
}
