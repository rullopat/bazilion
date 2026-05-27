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

import type { Message, Update } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, openConfig } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { dispatchCommand, parseCommand } from './commands/index.ts'
import type { CommandResult } from './commands/types.ts'
import type { TopicCreateApi } from './topic-autocreate.ts'

const SERVICE_TOPIC_KEY = 'TELEGRAM_SERVICE_TOPIC_ID'

/** Suppress duplicate General-topic redirects per chat. */
const GENERAL_REDIRECT_SUPPRESS_MS = 60_000
const _lastGeneralRedirectByChat = new Map<number, number>()

/**
 * Send surface the router uses to reply. Real wiring passes
 * `bot.api.sendMessage`-style invocation; tests can substitute a recording
 * spy.
 */
export interface ReplyApi extends TopicCreateApi {
  sendMessage(
    chatId: number,
    text: string,
    opts: {
      message_thread_id?: number
      parse_mode?: 'HTML' | 'MarkdownV2'
      disable_web_page_preview?: boolean
    },
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
  | { kind: 'agent_topic'; agentId: string; topicId: number }
  | { kind: 'general_redirect'; suppressed: boolean }
  | { kind: 'unknown_topic'; topicId: number }
  | { kind: 'non_message' }
  | { kind: 'foreign_chat'; chatId: number }

/**
 * Dispatch a single update. Returns an outcome describing what the router
 * did so the bot lifecycle can log it (and tests can assert on it).
 */
export async function routeUpdate(deps: RouterDeps, update: Update): Promise<RouteOutcome> {
  const m = update.message ?? update.edited_message ?? null
  if (!m) return { kind: 'non_message' }

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
    // Step-3 behavior: identify only. Real chat-back ships in Step 6.
    // We don't reply; the bot lifecycle's caller logs the inbound separately.
    return { kind: 'agent_topic', agentId: agent.id, topicId: threadId }
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
  if (!parsed) {
    // Plain text in the service chat — acknowledge once with a hint.
    await deps.api.sendMessage(deps.chatId, 'Run /help for the command list.', {
      message_thread_id: m.message_thread_id ?? undefined,
      parse_mode: 'HTML',
    })
    return { kind: 'service_plain_text' }
  }

  const result = await dispatchCommand(parsed, {
    db: deps.db,
    paths: deps.paths,
    authToken: deps.authToken,
    api: deps.api,
    chatId: deps.chatId,
    from: m.from!,
  })

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

async function handleGeneral(deps: RouterDeps, m: Message): Promise<RouteOutcome> {
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

async function sendCommandResult(
  deps: RouterDeps,
  threadId: number | undefined,
  result: CommandResult,
): Promise<void> {
  await deps.api.sendMessage(deps.chatId, result.text, {
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    ...(result.parseMode ? { parse_mode: result.parseMode } : {}),
    ...(result.disableWebPagePreview ? { disable_web_page_preview: true } : {}),
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
}
