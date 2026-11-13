// Inbound update router. Classifies each update by (chat, topic) and dispatches it:
//
//   service topic   the ⚙ bazilion topic → slash commands (/talk, /spawn, ...)
//   agent topic     a topic bound to an agent → topic commands, question answers, or the
//                   agent's follow-up queue
//   General         no thread / thread ≤ 1 → a redirect to the service topic (once a minute)
//   unknown topic   a topic with no agent → a hint to bind it with /talk
//
// Only allowlisted users (the paired owner and the members they add) get past the sender gate.

import type { Agent, Attachment } from '@bazilion/api-types'
import type { CallbackQuery, InlineKeyboardMarkup, Message, Update, User } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, openConfig, profileRepo, telegramPairingRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import * as userQueue from '../../core/repos/user-queue.ts'
import { enqueueUserInput } from '../user-queue.ts'
import { dispatchCommand, parseCommand } from './commands/index.ts'
import { namePrompt, SPAWN_PROFILE_CALLBACK_PREFIX, spawnAndBind } from './commands/spawn.ts'
import { SPAWN_TEAM_CALLBACK_PREFIX, spawnTeamAndBind } from './commands/spawn-team.ts'
import type { CommandApi, CommandResult } from './commands/types.ts'
import { MIGRATED_CHAT_KEY, readServiceTopicId } from './config.ts'
import { htmlEscape } from './html.ts'
import { downloadMediaBytes, extractMedia } from './media.ts'
import { isTelegramSenderAllowed } from './origin.ts'
import { answerFromTelegram, questionCallback, questionReply } from './questions.ts'
import { reactSeen } from './reactions.ts'
import { setPendingSpawn, takePendingSpawn } from './spawn-state.ts'

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
  /** Used by the `/spawn` keyboard flow to update the picker message after a tap. */
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
  /** Resolve a file_id to a downloadable file_path (inbound media). */
  getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }>
}

export interface RouterDeps {
  db: BazilionDb
  paths: Paths
  api: ReplyApi
  chatId: number
  /** Bot token — needed to download inbound media. */
  botToken?: string
}

export type RouteOutcome =
  | { kind: 'question_answer' }
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
  | { kind: 'general_redirect'; suppressed: boolean }
  | { kind: 'unknown_topic'; topicId: number }
  | { kind: 'callback_spawn_profile'; profileId: string }
  | { kind: 'callback_spawn_team'; templateId: string }
  | { kind: 'callback_unknown' }
  | { kind: 'non_message' }
  | { kind: 'ignored_bot' }
  | { kind: 'ignored_edit' }
  | { kind: 'unauthorized'; userId: number }
  | { kind: 'pairing_required' }
  | { kind: 'paired_owner'; userId: number }
  | { kind: 'chat_migrated'; toChatId: number }
  | { kind: 'foreign_chat'; chatId: number }

/** Suppress duplicate General-topic redirects per chat. */
const GENERAL_REDIRECT_SUPPRESS_MS = 60_000
const _lastGeneralRedirectByChat = new Map<number, number>()

/** Suppress repeated "not authorized" replies per user. */
const UNAUTHORIZED_SUPPRESS_MS = 60_000
const _lastUnauthorizedNoticeByUser = new Map<number, number>()

function shouldNotifyUnauthorized(userId: number): boolean {
  const now = Date.now()
  const last = _lastUnauthorizedNoticeByUser.get(userId) ?? 0
  if (now - last < UNAUTHORIZED_SUPPRESS_MS) return false
  _lastUnauthorizedNoticeByUser.set(userId, now)
  return true
}

/** The sender gate for messages and button taps. */
function allowedSender(db: BazilionDb, from: User | undefined): boolean {
  return !!from && !from.is_bot && isTelegramSenderAllowed(db, from.id)
}

/**
 * Dispatch a single update. Returns an outcome describing what the router
 * did so the bot lifecycle can log it (and tests can assert on it).
 */
export async function routeUpdate(deps: RouterDeps, update: Update): Promise<RouteOutcome> {
  if (update.callback_query) return routeCallback(deps, update.callback_query)

  // An edit reuses an old message identity with new content; it is not new input.
  if (update.edited_message) return { kind: 'ignored_edit' }

  const m = update.message ?? null
  if (!m) return { kind: 'non_message' }

  // Telegram never redelivers the bot's own messages, so this drops other bots in the group:
  // they must not drive agent turns.
  if (m.from?.is_bot) return { kind: 'ignored_bot' }

  // Supergroup migration: Telegram fires `migrate_to_chat_id` in the OLD chat when a basic
  // group is upgraded. Stash the new id; the operator confirms the switch (reconnect).
  if (typeof m.migrate_to_chat_id === 'number') {
    openConfig(deps.db).set(MIGRATED_CHAT_KEY, String(m.migrate_to_chat_id))
    return { kind: 'chat_migrated', toChatId: m.migrate_to_chat_id }
  }

  // Any other chat, including private chats with the bot. The new chat after a migration also
  // lands here (its messages carry `migrate_from_chat_id === our old id`).
  if (m.chat.id !== deps.chatId) {
    if (m.migrate_from_chat_id === deps.chatId) {
      openConfig(deps.db).set(MIGRATED_CHAT_KEY, String(m.chat.id))
      return { kind: 'chat_migrated', toChatId: m.chat.id }
    }
    return { kind: 'foreign_chat', chatId: m.chat.id }
  }

  // Anonymous admins and channel posts (sender_chat) never reach commands, downloads or turns.
  if (!m.from || m.sender_chat) return { kind: 'unauthorized', userId: m.from?.id ?? 0 }

  const serviceTopicId = readServiceTopicId(deps.db)
  const threadId = m.message_thread_id ?? null
  if (!telegramPairingRepo.status(deps.db).paired) {
    return handleUnpaired(deps, m, m.from, threadId, serviceTopicId)
  }
  if (!allowedSender(deps.db, m.from)) {
    if (shouldNotifyUnauthorized(m.from.id)) {
      await deps.api.sendMessage(
        deps.chatId,
        `You're not authorized to use this bot. Ask the owner to run /allow ${m.from.id}.`,
        { message_thread_id: threadId ?? undefined },
      )
    }
    return { kind: 'unauthorized', userId: m.from.id }
  }

  // A reply to a waiting question answers it instead of queueing behind the turn that asks.
  const questionId = questionReply(m)
  if (questionId && m.text && !parseCommand(m.text)) {
    await reply(
      deps,
      threadId ?? undefined,
      answerFromTelegram(questionId, { kind: 'text', text: m.text }),
    )
    return { kind: 'question_answer' }
  }

  // Inbound sometimes carries phantom thread ids ≤ 1 for General: treat them as no thread.
  if (threadId === null || threadId <= 1) return handleGeneral(deps)
  if (serviceTopicId !== null && threadId === serviceTopicId)
    return handleServiceChat(deps, m, m.from)

  const agent = agentRepo.findByTelegramTopicId(deps.db, threadId)
  if (!agent) {
    await deps.api.sendMessage(
      deps.chatId,
      "This topic isn't bound to a bazilion agent. Run /talk &lt;agent&gt; in the ⚙ bazilion topic to bind one.",
      { message_thread_id: threadId, parse_mode: 'HTML' },
    )
    return { kind: 'unknown_topic', topicId: threadId }
  }
  const parsed = parseCommand(m.text ?? m.caption ?? undefined)
  if (parsed)
    return handleAgentTopicCommand(deps, m.from, agent, threadId, parsed.name, parsed.args)
  return handleAgentTopicMessage(deps, m, m.from, agent, threadId)
}

/** Before pairing only `/pair <code>` in the service topic does anything. */
async function handleUnpaired(
  deps: RouterDeps,
  m: Message,
  from: User,
  threadId: number | null,
  serviceTopicId: number | null,
): Promise<RouteOutcome> {
  const parsed = parseCommand(m.text ?? undefined)
  if (serviceTopicId !== null && threadId === serviceTopicId && parsed?.name === 'pair') {
    const code = parsed.args.trim()
    const label = [from.first_name, from.last_name].filter(Boolean).join(' ') || null
    const paired =
      code.length > 0 &&
      telegramPairingRepo.consume(deps.db, {
        code,
        userId: from.id,
        username: from.username ?? null,
        label,
      })
    await deps.api.sendMessage(
      deps.chatId,
      paired
        ? '🔐 Telegram owner paired. Other people need /allow from you before they can use the bot.'
        : 'Pairing was not accepted. Generate a fresh code in authenticated Bazilion settings.',
      { message_thread_id: threadId },
    )
    return paired ? { kind: 'paired_owner', userId: from.id } : { kind: 'pairing_required' }
  }
  if (shouldNotifyUnauthorized(from.id)) {
    await deps.api.sendMessage(
      deps.chatId,
      'Telegram is not paired. Generate a one-time owner code in authenticated Bazilion settings.',
      { message_thread_id: threadId ?? undefined },
    )
  }
  return { kind: 'pairing_required' }
}

/** Plain input in an agent topic joins the agent's follow-up queue; 👀 marks it as seen. */
async function handleAgentTopicMessage(
  deps: RouterDeps,
  m: Message,
  from: User,
  agent: Agent,
  topicId: number,
): Promise<RouteOutcome> {
  const outcome = (queued: boolean): RouteOutcome => ({
    kind: 'agent_topic',
    agentId: agent.id,
    topicId,
    queued,
  })
  const text = m.text ?? m.caption ?? ''
  const media = extractMedia(m)
  // Stickers and the like carry neither.
  if (!text && !media) return outcome(false)
  const attachments: Attachment[] = []
  if (media) {
    const downloaded = deps.botToken
      ? await downloadMediaBytes(deps.api, deps.botToken, media)
      : null
    if (!downloaded?.ok) {
      await reply(
        deps,
        topicId,
        'The attachment could not be downloaded, so this message was not queued. Send it again.',
      )
      return outcome(false)
    }
    attachments.push({
      mimeType: downloaded.mimeType,
      data: downloaded.data,
      ...(downloaded.name ? { name: downloaded.name } : {}),
    })
  }
  try {
    await enqueueUserInput(
      agent.id,
      {
        message: text,
        attachments,
        telegram: {
          chatId: deps.chatId,
          threadId: topicId,
          messageId: m.message_id,
          userId: from.id,
        },
      },
      deps,
    )
  } catch (error) {
    await reply(
      deps,
      topicId,
      error instanceof userQueue.QueueCapacityError
        ? 'The queue is full, so this message was not queued. Check /queue.'
        : 'This message could not be queued. Check /queue.',
    )
    return outcome(false)
  }
  reactSeen(agent.id, deps.chatId, m.message_id)
  return outcome(true)
}

async function handleServiceChat(deps: RouterDeps, m: Message, from: User): Promise<RouteOutcome> {
  const parsed = parseCommand(m.text ?? m.caption ?? undefined)

  // A user who just tapped a profile button in /spawn is expected to send the name next.
  if (!parsed && m.text) {
    const pending = takePendingSpawn(deps.chatId, from.id)
    if (pending) {
      return await resumePendingSpawn(deps, m, pending.profileId, m.text)
    }
  }

  if (!parsed) {
    await deps.api.sendMessage(deps.chatId, 'Run /help for the command list.', {
      message_thread_id: m.message_thread_id ?? undefined,
      parse_mode: 'HTML',
    })
    return { kind: 'service_plain_text' }
  }

  const result = await dispatchCommand(
    parsed,
    { db: deps.db, paths: deps.paths, api: deps.api, chatId: deps.chatId, from },
    'service',
  )

  if ('unknown' in result) {
    await deps.api.sendMessage(
      deps.chatId,
      `Unknown command <code>/${htmlEscape(parsed.name)}</code>. Run /help for the command list.`,
      { message_thread_id: m.message_thread_id ?? undefined, parse_mode: 'HTML' },
    )
    return { kind: 'service_unknown_command', name: parsed.name }
  }

  await sendCommandResult(deps, m.message_thread_id ?? undefined, result)
  return { kind: 'service_command', name: parsed.name, handled: true }
}

async function handleAgentTopicCommand(
  deps: RouterDeps,
  from: User,
  agent: Agent,
  topicId: number,
  name: string,
  args: string,
): Promise<RouteOutcome> {
  const result = await dispatchCommand(
    { name, args },
    {
      db: deps.db,
      paths: deps.paths,
      api: deps.api,
      chatId: deps.chatId,
      from,
      agent,
      topicId,
    },
    'topic',
  )

  if ('unknown' in result) {
    await deps.api.sendMessage(
      deps.chatId,
      `Unknown command <code>/${htmlEscape(name)}</code> for this topic. Run /help for the command list.`,
      { message_thread_id: topicId, parse_mode: 'HTML' },
    )
    return { kind: 'agent_topic_unknown_command', agentId: agent.id, topicId, name }
  }

  await sendCommandResult(deps, topicId, result)
  return { kind: 'agent_topic_command', agentId: agent.id, topicId, name, handled: true }
}

async function handleGeneral(deps: RouterDeps): Promise<RouteOutcome> {
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
 * Complete the `/spawn` keyboard flow: the user has just typed the new agent's name (or `-` for
 * an automatic one) after picking a profile. Shares `spawnAndBind` with the typed-args path.
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
      `Profile <code>${htmlEscape(profileId)}</code> was removed while waiting for the name — start over with /spawn.`,
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

/** Inline-keyboard taps: question answers and the /spawn and /spawn_team pickers. */
async function routeCallback(deps: RouterDeps, q: CallbackQuery): Promise<RouteOutcome> {
  const callbackChatId = q.message?.chat.id
  if (callbackChatId !== deps.chatId || !allowedSender(deps.db, q.from)) {
    await deps.api
      .answerCallbackQuery(q.id, { text: 'Not authorized.', show_alert: true })
      .catch(() => undefined)
    return callbackChatId === undefined || callbackChatId === deps.chatId
      ? { kind: 'unauthorized', userId: q.from.id }
      : { kind: 'foreign_chat', chatId: callbackChatId }
  }
  const data = q.data ?? ''

  const answer = questionCallback(data)
  if (answer) {
    await deps.api
      .answerCallbackQuery(q.id, { text: answerFromTelegram(answer.questionId, answer.answer) })
      .catch(() => undefined)
    return { kind: 'question_answer' }
  }

  // Spawn-team picker: tapping a team template spawns it at once (names come from the template).
  if (data.startsWith(SPAWN_TEAM_CALLBACK_PREFIX)) {
    await deps.api.answerCallbackQuery(q.id, {}).catch(() => undefined)
    const templateId = data.slice(SPAWN_TEAM_CALLBACK_PREFIX.length)
    const result = await spawnTeamAndBind(
      { db: deps.db, paths: deps.paths, api: deps.api, chatId: deps.chatId },
      templateId,
      null,
    )
    await sendCommandResult(deps, q.message?.message_thread_id ?? undefined, result)
    return { kind: 'callback_spawn_team', templateId }
  }

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

  // The next plain-text message from this user is the new agent's name.
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

function reply(deps: RouterDeps, threadId: number | undefined, text: string): Promise<unknown> {
  return deps.api
    .sendMessage(deps.chatId, text, threadId !== undefined ? { message_thread_id: threadId } : {})
    .catch(() => undefined)
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

/** Test-only — clear the in-memory redirect and notice suppression maps. */
export function _resetRouterStateForTest(): void {
  _lastGeneralRedirectByChat.clear()
  _lastUnauthorizedNoticeByUser.clear()
}
