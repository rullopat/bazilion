// Inbound update router. Classifies each Telegram update by
// (chat_id, message_thread_id) and dispatches.
//
// Categories:
//
//   service_chat   the configured ⚙ bazilion topic → parse slash command
//   agent_topic    a topic bound to an agent via agents.telegram_topic_id
//   general        no thread / thread <= 1 → polite redirect (60s suppression)
//   unknown        topic with no agent binding and not the service chat
//   non_message    service updates, member changes — log + advance offset
//
// Agent-topic inbound for Step 3 is "log and ack to the bot lifecycle"
// only — actual chat-back routing ships in Step 6 alongside the outbound
// mirror from runAgentTurn.

import type { CallbackQuery, InlineKeyboardMarkup, Message, Update } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, openConfig, profileRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { dispatchCommand, parseCommand } from './commands/index.ts'
import { namePrompt, SPAWN_PROFILE_CALLBACK_PREFIX, spawnAndBind } from './commands/spawn.ts'
import type { CommandApi, CommandResult } from './commands/types.ts'
import { enqueueAgentMessage } from './inbound-queue.ts'
import {
  _resetLoopGuardForTest,
  allowTelegramInbound,
  shouldNotifyInboundThrottle,
} from './loop-guard.ts'
import { reactSeen } from './reactions.ts'
import { setPendingSpawn, takePendingSpawn } from './spawn-state.ts'

const SERVICE_TOPIC_KEY = 'TELEGRAM_SERVICE_TOPIC_ID'

/** Suppress duplicate General-topic redirects per chat. */
const GENERAL_REDIRECT_SUPPRESS_MS = 60_000
const _lastGeneralRedirectByChat = new Map<number, number>()

/**
 * Send surface the router uses to reply. Real wiring passes
 * `bot.api.sendMessage`-style invocation; tests can substitute a recording
 * spy.
 */
export interface ReplyApi extends CommandApi {
  sendMessage(
    chatId: number,
    text: string,
    opts: {
      message_thread_id?: number
      parse_mode?: 'HTML' | 'MarkdownV2'
      disable_web_page_preview?: boolean
      reply_markup?: InlineKeyboardMarkup
    },
  ): Promise<{ message_id: number }>
  /**
   * Used by the `/spawn` keyboard flow to update the picker message after
   * the user taps a profile button.
   */
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts: { parse_mode?: 'HTML' | 'MarkdownV2'; reply_markup?: InlineKeyboardMarkup },
  ): Promise<unknown>
  /** Acknowledge a callback_query so Telegram stops the loading spinner. */
  answerCallbackQuery(
    callbackQueryId: string,
    opts?: { text?: string; show_alert?: boolean },
  ): Promise<unknown>
}

export interface RouterDeps {
  db: BazilionDb
  paths: Paths
  authToken: string
  api: ReplyApi
  chatId: number
}

export type RouteOutcome =
  | { kind: 'service_command'; name: string; handled: boolean }
  | { kind: 'service_unknown_command'; name: string }
  | { kind: 'service_plain_text' }
  | { kind: 'spawn_name_input'; profileId: string; spawned: boolean }
  | { kind: 'agent_topic'; agentId: string; topicId: number; queued: boolean }
  | {
      kind: 'agent_topic_command'
      agentId: string
      topicId: number
      name: string
      handled: boolean
    }
  | { kind: 'agent_topic_unknown_command'; agentId: string; topicId: number; name: string }
  | { kind: 'rate_limited'; agentId: string; topicId: number }
  | { kind: 'general_redirect'; suppressed: boolean }
  | { kind: 'unknown_topic'; topicId: number }
  | { kind: 'callback_spawn_profile'; profileId: string }
  | { kind: 'callback_unknown' }
  | { kind: 'non_message' }
  | { kind: 'ignored_bot' }
  | { kind: 'foreign_chat'; chatId: number }

/**
 * Dispatch a single update. Returns an outcome describing what the router
 * did so the bot lifecycle can log it (and tests can assert on it).
 */
export async function routeUpdate(deps: RouterDeps, update: Update): Promise<RouteOutcome> {
  // Callback queries (from inline-keyboard taps) arrive on their own
  // dedicated field — handle them before the message-only fallthrough.
  if (update.callback_query) return handleCallbackQuery(deps, update.callback_query)

  const m = update.message ?? update.edited_message ?? null
  if (!m) return { kind: 'non_message' }

  // Drop anything authored by a bot. bazilion never sees its OWN messages
  // (Telegram doesn't redeliver them), so this guards against *other* bots in
  // the supergroup driving agent turns — the one Telegram-side loop vector for
  // a single-bot install. Also covers the bot's own forum-topic service
  // messages, which we don't process anyway.
  if (m.from?.is_bot) return { kind: 'ignored_bot' }

  // Foreign chat — any chat that isn't the configured supergroup. Telegram
  // private chats (the bot's DM with the operator) land here.
  if (m.chat.id !== deps.chatId) return { kind: 'foreign_chat', chatId: m.chat.id }

  const serviceTopicId = readServiceTopicId(deps.db)
  const threadId = m.message_thread_id ?? null

  // General topic: outbound API rejects message_thread_id=1, and inbound
  // sometimes carries phantom thread ids ≤ 1 — collapse both cases into
  // "no thread".
  const isGeneral = threadId === null || threadId <= 1
  if (isGeneral) {
    return handleGeneral(deps, m)
  }

  // Service chat dispatch.
  if (serviceTopicId !== null && threadId === serviceTopicId) {
    return handleServiceChat(deps, m)
  }

  // Agent topic — look up by thread id.
  const agent = agentRepo.findByTelegramTopicId(deps.db, threadId)
  if (agent) {
    const parsed = parseCommand(m.text ?? m.caption ?? undefined)
    if (parsed) {
      return await handleAgentTopicCommand(deps, m, agent, threadId, parsed.name, parsed.args)
    }
    // Step 6: plain text in a bound agent topic queues into the agent's
    // inbound queue. The queue's drain loop owns runAgentTurn calls — it
    // serializes them so concurrent worker spawns don't corrupt agent
    // state. Messages that arrive while a turn is in flight are
    // concatenated and processed together when the current turn ends, so
    // the agent gets one combined reply addressing everything.
    const userText = m.text ?? m.caption ?? ''
    if (!userText) {
      // Non-text message in agent topic (sticker, photo, etc.) — skip.
      return { kind: 'agent_topic', agentId: agent.id, topicId: threadId, queued: false }
    }
    // Per-agent inbound rate budget — backstop against a human/script spamming
    // a topic faster than the agent can answer. Over budget: drop the message
    // and post a single cooldown notice (suppressed for the rest of the
    // cooldown window).
    if (!allowTelegramInbound(agent.id)) {
      if (shouldNotifyInboundThrottle(agent.id)) {
        await deps.api.sendMessage(
          deps.chatId,
          "Whoa — that's a lot of messages very fast. I'll pause new ones for a minute so I can catch up.",
          { message_thread_id: threadId, parse_mode: 'HTML' },
        )
      }
      return { kind: 'rate_limited', agentId: agent.id, topicId: threadId }
    }
    enqueueAgentMessage(agent.id, userText)
    // 👀 "I see this" indicator on the user's message. Cleared by the
    // mirror when the agent's reply lands.
    reactSeen(agent.id, deps.chatId, m.message_id)
    return { kind: 'agent_topic', agentId: agent.id, topicId: threadId, queued: true }
  }

  // Orphan / unknown topic.
  await deps.api.sendMessage(
    deps.chatId,
    "This topic isn't bound to a bazilion agent. Run /talk &lt;agent&gt; in the ⚙ bazilion topic to bind one.",
    { message_thread_id: threadId, parse_mode: 'HTML' },
  )
  return { kind: 'unknown_topic', topicId: threadId }
}

async function handleServiceChat(deps: RouterDeps, m: Message): Promise<RouteOutcome> {
  const parsed = parseCommand(m.text ?? m.caption ?? undefined)

  // Pending-spawn name-input has priority over the "unknown text" hint —
  // a user who just tapped a profile button is expected to follow up with
  // a name as plain text, not a command.
  if (!parsed && m.from && m.text) {
    const pending = takePendingSpawn(deps.chatId, m.from.id)
    if (pending) {
      return await resumePendingSpawn(deps, m, pending.profileId, m.text)
    }
  }

  if (!parsed) {
    // Plain text in the service chat — acknowledge once with a hint.
    await deps.api.sendMessage(deps.chatId, 'Run /help for the command list.', {
      message_thread_id: m.message_thread_id ?? undefined,
      parse_mode: 'HTML',
    })
    return { kind: 'service_plain_text' }
  }

  const result = await dispatchCommand(
    parsed,
    {
      db: deps.db,
      paths: deps.paths,
      authToken: deps.authToken,
      api: deps.api,
      chatId: deps.chatId,
      from: m.from!,
    },
    'service',
  )

  if ('unknown' in result) {
    await deps.api.sendMessage(
      deps.chatId,
      `Unknown command <code>/${escapeForHtml(parsed.name)}</code>. Run /help for the command list.`,
      { message_thread_id: m.message_thread_id ?? undefined, parse_mode: 'HTML' },
    )
    return { kind: 'service_unknown_command', name: parsed.name }
  }

  // result is narrowed to CommandResult — TS now knows .text exists.
  await sendCommandResult(deps, m.message_thread_id ?? undefined, result)
  return { kind: 'service_command', name: parsed.name, handled: true }
}

async function handleAgentTopicCommand(
  deps: RouterDeps,
  m: Message,
  agent: import('@bazilion/api-types').Agent,
  topicId: number,
  name: string,
  args: string,
): Promise<RouteOutcome> {
  const result = await dispatchCommand(
    { name, args },
    {
      db: deps.db,
      paths: deps.paths,
      authToken: deps.authToken,
      api: deps.api,
      chatId: deps.chatId,
      from: m.from!,
      agent,
      topicId,
      messageId: m.message_id,
    },
    'topic',
  )

  if ('unknown' in result) {
    await deps.api.sendMessage(
      deps.chatId,
      `Unknown command <code>/${escapeForHtml(name)}</code> for this topic. Run /help for the command list.`,
      { message_thread_id: topicId, parse_mode: 'HTML' },
    )
    return { kind: 'agent_topic_unknown_command', agentId: agent.id, topicId, name }
  }

  await sendCommandResult(deps, topicId, result)
  return { kind: 'agent_topic_command', agentId: agent.id, topicId, name, handled: true }
}

async function handleGeneral(
  deps: RouterDeps,
  // _m is unused — General-topic handling is chat-wide, not per-message.
  _m: Message,
): Promise<RouteOutcome> {
  const now = Date.now()
  const last = _lastGeneralRedirectByChat.get(deps.chatId) ?? 0
  if (now - last < GENERAL_REDIRECT_SUPPRESS_MS) {
    return { kind: 'general_redirect', suppressed: true }
  }
  _lastGeneralRedirectByChat.set(deps.chatId, now)
  await deps.api.sendMessage(
    deps.chatId,
    'Commands run in the ⚙ bazilion topic, not in General. Pop over there and try /help.',
    // No message_thread_id — Telegram rejects message_thread_id=1 for General.
    {},
  )
  return { kind: 'general_redirect', suppressed: false }
}

/**
 * Complete the `/spawn` keyboard flow: the user has just typed the new
 * agent's name (or `-` for auto-name) as a plain message in the service
 * chat after picking a profile via the inline keyboard. We delegate the
 * heavy lifting (spawnAgent + ensureAgentTopic + reply text) to the
 * /spawn handler's exported `spawnAndBind` so the typed-args path and the
 * keyboard path share one implementation.
 */
async function resumePendingSpawn(
  deps: RouterDeps,
  m: Message,
  profileId: string,
  rawName: string,
): Promise<RouteOutcome> {
  const profile = profileRepo.get(deps.db, profileId)
  if (!profile) {
    await deps.api.sendMessage(
      deps.chatId,
      `Profile <code>${escapeForHtml(profileId)}</code> was removed while waiting for the name — start over with /spawn.`,
      { message_thread_id: m.message_thread_id ?? undefined, parse_mode: 'HTML' },
    )
    return { kind: 'spawn_name_input', profileId, spawned: false }
  }
  const result = await spawnAndBind(
    {
      db: deps.db,
      paths: deps.paths,
      api: deps.api,
      chatId: deps.chatId,
    },
    profile,
    rawName.trim(),
  )
  await sendCommandResult(deps, m.message_thread_id ?? undefined, result)
  return { kind: 'spawn_name_input', profileId, spawned: true }
}

/**
 * Handle an inline-keyboard tap. Step 4 only knows about the spawn-profile
 * picker — other callback_data values are logged + acknowledged but
 * otherwise ignored.
 */
async function handleCallbackQuery(deps: RouterDeps, q: CallbackQuery): Promise<RouteOutcome> {
  // Always acknowledge so Telegram's loading spinner stops — even when we
  // don't know what the callback is for.
  const data = q.data ?? ''
  if (!data.startsWith(SPAWN_PROFILE_CALLBACK_PREFIX)) {
    await deps.api.answerCallbackQuery(q.id, {}).catch(() => undefined)
    return { kind: 'callback_unknown' }
  }

  const profileId = data.slice(SPAWN_PROFILE_CALLBACK_PREFIX.length)
  const profile = profileRepo.get(deps.db, profileId)
  if (!profile) {
    await deps.api
      .answerCallbackQuery(q.id, {
        text: `Profile ${profileId} no longer exists.`,
        show_alert: true,
      })
      .catch(() => undefined)
    return { kind: 'callback_unknown' }
  }

  // Stash the pending state on (chat, user) so the next plain-text message
  // from this user gets routed as the name input.
  setPendingSpawn(deps.chatId, q.from.id, profile.id)

  // Update the picker message in place — buttons go away, prompt appears.
  if (q.message) {
    await deps.api
      .editMessageText(deps.chatId, q.message.message_id, namePrompt(profile), {
        parse_mode: 'HTML',
      })
      .catch((e) => {
        // Editing can fail if the message was deleted or is too old; fall
        // back to a fresh prompt message so the user still sees it.
        console.warn(
          'telegram: editMessageText for spawn picker failed, sending fresh prompt:',
          e instanceof Error ? e.message : String(e),
        )
        return deps.api.sendMessage(deps.chatId, namePrompt(profile), {
          ...(q.message?.message_thread_id !== undefined
            ? { message_thread_id: q.message.message_thread_id }
            : {}),
          parse_mode: 'HTML',
        })
      })
  }

  await deps.api.answerCallbackQuery(q.id, {}).catch(() => undefined)
  return { kind: 'callback_spawn_profile', profileId: profile.id }
}

async function sendCommandResult(
  deps: RouterDeps,
  threadId: number | undefined,
  result: CommandResult,
): Promise<void> {
  await deps.api.sendMessage(deps.chatId, result.text, {
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    ...(result.parseMode ? { parse_mode: result.parseMode } : {}),
    ...(result.disableWebPagePreview ? { disable_web_page_preview: true } : {}),
    ...(result.replyMarkup ? { reply_markup: result.replyMarkup } : {}),
  })
}

function readServiceTopicId(db: BazilionDb): number | null {
  const raw = openConfig(db).get(SERVICE_TOPIC_KEY) ?? ''
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Test-only — clear the in-memory General-redirect suppression map. */
export function _resetRouterStateForTest(): void {
  _lastGeneralRedirectByChat.clear()
  _resetLoopGuardForTest()
}
