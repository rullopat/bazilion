// Shared shapes for the service-chat + topic-context command surfaces.
// Every command's handle function takes a CommandCtx and returns a
// CommandResult — the router posts the result back into whichever topic
// the command was invoked from.

import type { Agent } from '@bazilion/api-types'
import type { InlineKeyboardMarkup, User } from 'grammy/types'
import type { BazilionDb } from '../../../core/db/client.ts'
import type { Paths } from '../../../core/paths.ts'
import type { TopicCreateApi } from '../topic-autocreate.ts'

/**
 * Narrow Bot API subset commands may call. Step 3 only needed
 * `TopicCreateApi` (for `/talk`). Step 5's topic-context commands add
 * `closeForumTopic` (used by `/close`). Future commands grow this
 * interface; per-command tests stay easy because each handler only sees
 * the methods it needs.
 */
export interface CommandApi extends TopicCreateApi {
  closeForumTopic(chatId: number, messageThreadId: number): Promise<boolean>
}

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
  /**
   * Bound agent of the current topic, when the command was issued inside an
   * agent topic. `undefined` for service-chat commands. Topic-context
   * handlers (`/close`, `/rebind`, `/unbind`) require this; service-chat
   * handlers ignore it (with the optional exception of `/help`, which
   * contextualizes its output when present).
   */
  agent?: Agent
  /** Topic id of the agent topic this command was issued in. Mirrors `agent`. */
  topicId?: number
  /** Message id of the message that carried the command. Used by handlers that need to edit or reply-by-id. */
  messageId?: number
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

/**
 * Where a command may run:
 *   service — only in the ⚙ bazilion topic; registered in setMyCommands.
 *   topic   — only in bound agent topics; NOT in setMyCommands so the
 *             slash autocomplete stays focused on the service-chat surface.
 *             Topic-context handlers receive the bound agent on ctx.agent.
 *   any     — both contexts; e.g. /help is universally callable.
 */
export type CommandContext = 'service' | 'topic' | 'any'

export interface CommandDescriptor {
  /** The command word without leading slash. e.g. "talk". */
  name: string
  /** Telegram's setMyCommands description (≤ 256 chars). */
  description: string
  handle: CommandHandler
  /** Optional aliases — secondary command words that route to the same handler but don't appear in the slash menu. */
  aliases?: readonly string[]
  /** Where the command is callable from. Defaults to 'service' when omitted. */
  context?: CommandContext
}
