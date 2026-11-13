// Directory message: the pinned message in the ⚙ bazilion service topic that lists every agent
// and links its forum topic. `notifyDirectoryDirty()` coalesces bursts of agent changes into one
// edit on the next tick. If someone deletes the message, the next refresh posts and pins a new
// one.

import type { InlineKeyboardMarkup } from 'grammy/types'
import type { BazilionDb } from '../../core/db/client.ts'
import { agentRepo, openConfig, teamRepo } from '../../core/index.ts'
import type { Paths } from '../../core/paths.ts'
import { DIRECTORY_MESSAGE_KEY, readConfigNumber, readServiceTopicId } from './config.ts'
import { htmlEscape } from './html.ts'
import { telegramLive } from './live.ts'
import { topicDeepLink } from './naming.ts'

/** The Bot API calls the directory makes; tests pass a recording mock. */
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

/** Agents grouped by team, each with a link to its topic or an `(unbound)` marker. */
export function agentListLines(db: BazilionDb, paths: Paths, chatId: number): string[] {
  const agents = agentRepo.list(db) // archived excluded by default
  const lines: string[] = []
  for (const team of teamRepo.list(db, paths)) {
    const members = agents.filter((agent) => agent.teamId === team.id)
    if (members.length === 0) continue
    lines.push('', `<b>${htmlEscape(team.id)}</b>`)
    for (const agent of members) {
      const label = `  • <code>${htmlEscape(agent.name)}</code>`
      lines.push(
        agent.telegramTopicId === null
          ? `${label} <i>(unbound)</i>`
          : `${label} → <a href="${topicDeepLink(chatId, agent.telegramTopicId)}">open</a>`,
      )
    }
  }
  return lines
}

export function buildDirectoryBody(db: BazilionDb, paths: Paths, chatId: number): string {
  if (agentRepo.list(db).length === 0) {
    return [
      '👋 <b>bazilion is online</b>',
      '',
      'No agents yet — run /spawn in this topic to create one.',
      'See /help for the command list.',
    ].join('\n')
  }
  return [
    '🛟 <b>Available agents</b>',
    ...agentListLines(db, paths, chatId),
    '',
    'Run /help for commands.',
  ].join('\n')
}

/**
 * Bring the pinned directory up to date: edit it in place, or post and pin a new one when it is
 * gone. No-op until activation has created the service topic.
 */
export async function refreshDirectoryMessage(deps: DirectoryDeps): Promise<void> {
  const serviceTopicId = readServiceTopicId(deps.db)
  if (serviceTopicId === null) return
  const body = buildDirectoryBody(deps.db, deps.paths, deps.chatId)
  const messageId = readConfigNumber(deps.db, DIRECTORY_MESSAGE_KEY)

  if (messageId !== null) {
    try {
      await deps.api.editMessageText(deps.chatId, messageId, body, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })
      return
    } catch (e) {
      // An identical body is refused as "not modified": the directory is already current.
      if (isNotModifiedError(e)) return
      if (!isMessageGoneError(e)) throw e
      console.warn(
        'telegram directory: pinned message gone, recreating —',
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  const sent = await deps.api.sendMessage(deps.chatId, body, {
    message_thread_id: serviceTopicId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  openConfig(deps.db).set(DIRECTORY_MESSAGE_KEY, String(sent.message_id))
  try {
    await deps.api.pinChatMessage(deps.chatId, sent.message_id, { disable_notification: true })
  } catch (e) {
    // Pinning is best effort; the directory works without it.
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

let refreshScheduled = false

/**
 * Mark the directory dirty. Agent changes call this from anywhere; one refresh runs on the next
 * tick against the live bot, and nothing happens while the bot is stopped. Never throws.
 */
export function notifyDirectoryDirty(): void {
  if (refreshScheduled) return
  refreshScheduled = true
  setImmediate(() => {
    refreshScheduled = false
    const live = telegramLive()
    if (!live) return
    refreshDirectoryMessage({ ...live, api: live.api as unknown as DirectoryApi }).catch((e) =>
      console.warn(
        'telegram directory: scheduled refresh failed —',
        e instanceof Error ? e.message : String(e),
      ),
    )
  })
}

/** Test-only. */
export function _resetDirectoryStateForTest(): void {
  refreshScheduled = false
}
