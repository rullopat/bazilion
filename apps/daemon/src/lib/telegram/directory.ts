// Directory message — the pinned message at the top of the ⚙ bazilion
// service chat that lists every agent and (when bound) deep-links to their
// forum topic. Updated lazily after every agent CRUD event via
// `notifyDirectoryDirty()`, which coalesces bursts of changes into a single
// `editMessageText` call on the next tick.
//
// Recreate-on-delete: if a human removes the directory message from
// Telegram, the next refresh sees a "message to edit not found" error from
// editMessageText, falls back to sendMessage + pin, and persists the new
// message id to `TELEGRAM_DIRECTORY_MESSAGE_ID`.

import type { InlineKeyboardMarkup } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, groupRepo, openConfig } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { getTelegramBotState } from './bot.ts'
import { htmlEscape } from './html.ts'
import { topicDeepLink } from './naming.ts'

const SERVICE_TOPIC_KEY = 'TELEGRAM_SERVICE_TOPIC_ID'
const DIRECTORY_MESSAGE_KEY = 'TELEGRAM_DIRECTORY_MESSAGE_ID'

/**
 * Minimal Bot API surface the directory needs. Mirrors the activation
 * pattern — production code passes grammY's `bot.api`, tests substitute a
 * recording mock.
 */
export interface DirectoryApi {
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
}

export interface DirectoryDeps {
  db: BazilionDb
  paths: Paths
  api: DirectoryApi
  chatId: number
}

/**
 * Build the directory message body. Group agents by their bazilion group;
 * within each group, show bound agents with a clickable deep-link and
 * unbound agents with an `(unbound)` marker. Empty installs show a
 * welcome / "spawn one to get started" hint.
 */
export function buildDirectoryBody(db: BazilionDb, paths: Paths, chatId: number): string {
  const groups = groupRepo.list(db, paths)
  const agents = agentRepo.list(db) // archived excluded by default
  if (agents.length === 0) {
    return [
      '👋 <b>bazilion is online</b>',
      '',
      'No agents yet — run /spawn in this topic to create one.',
      'See /help for the command list.',
    ].join('\n')
  }

  const byGroup = new Map<string, typeof agents>()
  for (const a of agents) {
    const bucket = byGroup.get(a.groupId) ?? []
    bucket.push(a)
    byGroup.set(a.groupId, bucket)
  }

  const lines: string[] = ['🛟 <b>Available agents</b>', '']
  for (const g of groups) {
    const members = byGroup.get(g.id)
    if (!members || members.length === 0) continue
    lines.push(`<b>${htmlEscape(g.id)}</b>`)
    for (const a of members) {
      const topicId = agentRepo.getTelegramTopicId(db, a.id)
      const label = `  • <code>${htmlEscape(a.name)}</code>`
      if (topicId !== null) {
        const url = topicDeepLink(chatId, topicId)
        lines.push(`${label} → <a href="${url}">open</a>`)
      } else {
        lines.push(`${label} <i>(unbound)</i>`)
      }
    }
    lines.push('')
  }
  // Drop trailing blank line.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  lines.push('', 'Run /help for commands.')
  return lines.join('\n')
}

/**
 * Push the directory body into the pinned message. Tries editMessageText
 * first; on a "message to edit not found" failure (human deleted it),
 * recreates by sendMessage + pin and updates the persisted id.
 *
 * No-op when the bot isn't running, when creds aren't configured, or when
 * the service chat hasn't been activated yet — callers don't need to gate
 * around those cases.
 */
export async function refreshDirectoryMessage(deps: DirectoryDeps): Promise<void> {
  const config = openConfig(deps.db)
  const serviceTopicRaw = config.get(SERVICE_TOPIC_KEY) ?? ''
  if (!serviceTopicRaw) return
  const serviceTopicId = Number(serviceTopicRaw)
  if (!Number.isFinite(serviceTopicId)) return

  const body = buildDirectoryBody(deps.db, deps.paths, deps.chatId)

  const messageIdRaw = config.get(DIRECTORY_MESSAGE_KEY) ?? ''
  const messageId = messageIdRaw ? Number(messageIdRaw) : null

  if (messageId !== null && Number.isFinite(messageId)) {
    try {
      await deps.api.editMessageText(deps.chatId, messageId, body, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
      return
    } catch (e) {
      if (isNotModifiedError(e)) {
        // Telegram rejects edits when the new text is identical to the old —
        // benign for us, just means the directory was already current.
        return
      }
      if (!isMessageGoneError(e)) {
        throw e
      }
      // Fall through to recreate.
      console.warn(
        'telegram directory: pinned message gone, recreating —',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  // Either no message id stored or the prior edit said the message is gone:
  // post a new directory + pin + persist its id.
  const sent = await deps.api.sendMessage(deps.chatId, body, {
    message_thread_id: serviceTopicId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  config.set(DIRECTORY_MESSAGE_KEY, String(sent.message_id))
  try {
    await deps.api.pinChatMessage(deps.chatId, sent.message_id, { disable_notification: true })
  } catch (e) {
    // Pin is best-effort — the directory still works without it.
    console.warn(
      'telegram directory: pin failed (continuing):',
      e instanceof Error ? e.message : String(e),
    )
  }
}

function isMessageGoneError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return (
    msg.includes('message to edit not found') ||
    msg.includes('message_id_invalid') ||
    msg.includes('message can') // "message can't be edited" or similar
  )
}

function isNotModifiedError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.message.toLowerCase().includes('message is not modified')
}

// ─── notify ────────────────────────────────────────────────────────────
//
// `notifyDirectoryDirty()` is the public coalescing entry point. Multiple
// CRUD events happening in close succession (e.g. /spawn → ensureAgentTopic
// → setTelegramTopicId — three consecutive mutations on a single user
// action) collapse into one refresh on the next tick. The refresh reads
// the live bot state to find the chatId + api; if the bot isn't running,
// the notify is a silent no-op.

let _refreshScheduled = false

/**
 * Mark the directory dirty. Schedules a single async refresh on the next
 * tick if one isn't already pending. Safe to call from anywhere — repo
 * mutation sites, route handlers, bot internals. The function never
 * throws; refresh errors are logged but never bubble to callers.
 */
export function notifyDirectoryDirty(): void {
  if (_refreshScheduled) return
  _refreshScheduled = true
  setImmediate(() => {
    _refreshScheduled = false
    void runScheduledRefresh()
  })
}

/**
 * Force an immediate refresh — used by tests and by callers (like
 * activation) that need to await completion before continuing. Most
 * production code should use `notifyDirectoryDirty()` instead.
 */
export async function refreshDirectoryNow(deps: DirectoryDeps): Promise<void> {
  await refreshDirectoryMessage(deps)
}

/**
 * Internal: pulled the bot's runtime state and runs a refresh against it.
 * Catches everything — a logged warning is better than crashing the
 * caller for what's ultimately a UI-state update.
 */
async function runScheduledRefresh(): Promise<void> {
  try {
    const deps = resolveLiveDeps()
    if (!deps) return
    await refreshDirectoryMessage(deps)
  } catch (e) {
    console.warn(
      'telegram directory: scheduled refresh failed —',
      e instanceof Error ? e.message : String(e),
    )
  }
}

// Lazy import to break the cycle: bot.ts imports directory.ts (via
// activation), and directory.ts wants to peek at bot.ts's live handle.
// We resolve the deps at call time, not at module load.
type LiveDepsResolver = () => DirectoryDeps | null
let _liveDepsResolver: LiveDepsResolver | null = null

/**
 * Wired by bot.ts at start time — gives the directory module access to
 * the live bot's chatId / api / db / paths without a static import cycle.
 */
export function installLiveDepsResolver(resolver: LiveDepsResolver): void {
  _liveDepsResolver = resolver
}

function resolveLiveDeps(): DirectoryDeps | null {
  if (!_liveDepsResolver) return null
  const state = getTelegramBotState()
  if (!state || !state.running) return null
  return _liveDepsResolver()
}

/** Test-only — clear the scheduled-refresh flag + the live resolver. */
export function _resetDirectoryStateForTest(): void {
  _refreshScheduled = false
  _liveDepsResolver = null
}
