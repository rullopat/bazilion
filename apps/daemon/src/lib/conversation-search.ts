// Search the Agents' conversations: the messages (yours and the Agent's replies, not tool output)
// that hold every word asked for, in what each conversation shows (its current branch, after any
// summary), with stored credentials taken out. A transcript is parsed only when its raw text holds
// every word.

import { join } from 'node:path'
import type { ConversationSearchHit, ConversationSearchResponse } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import { DomainError } from '../core/errors.ts'
import type { Paths } from '../core/paths.ts'
import { piMessagesToProviderView } from '../runtime/index.ts'
import { branchOf, type ConversationHistory, conversationHistory } from '../runtime/pi/history.ts'
import { parseSessionText, readSessionText } from '../runtime/pi/session-file.ts'
import { redactExactValues } from '../runtime/worker/runtime.ts'

const INBOX_WAKE_PREFIX = '[[bazilion:inbox-wake]]\n'
const WAKE_PREFIX = '[[bazilion:wake]]\n'
const MAX_WORDS = 8
export const MAX_SEARCH_HITS = 50
/** A snippet starts a few words before the first word found, so that a short line shows it. */
const BEFORE = 24
const AFTER = 140

/** The words of a query, lower-cased, each once; refused when too short or too many. */
export function searchWords(query: string): string[] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
  if (words.join('').length < 2) throw new DomainError(400, 'Search for at least two characters')
  if (words.length > MAX_WORDS) throw new DomainError(400, `Search for at most ${MAX_WORDS} words`)
  return words
}

/** Markdown as it reads: no emphasis marks, headings, list marks, table rules or link targets. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
}

/** The text around the first word found, whitespace folded, with ellipses where it is cut. */
export function snippetOf(text: string, words: readonly string[]): string {
  const flat = plainText(text).replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = Math.min(
    ...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0),
    flat.length,
  )
  const start = Math.max(0, at - BEFORE)
  const end = Math.min(flat.length, at + AFTER)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

interface ConversationRow {
  id: string
  agentId: string
  title: string
  agentName: string
  archived: number
  teamId: string
  teamName: string
  selected: string | null
}

/**
 * The work is done one conversation at a time, letting the daemon do other things between two,
 * and stops when the request that asked is gone (Jump to asks again as you type).
 */
export async function searchConversations(
  db: BazilionDb,
  paths: Paths,
  options: {
    query: string
    agentId?: string
    limit?: number
    secrets?: readonly string[]
    signal?: AbortSignal
  },
): Promise<ConversationSearchResponse> {
  const words = searchWords(options.query)
  const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_SEARCH_HITS)
  // In the raw JSON a word reads as JSON writes it (a quote or a backslash escaped).
  const raw = words.map((word) => JSON.stringify(word).slice(1, -1))
  const rows = db.raw
    .query<ConversationRow, [string | null, string | null]>(
      `SELECT c.id, c.agent_id agentId, c.title, a.name agentName, a.status = 'archived' archived,
        a.team_id teamId, t.name teamName, s.conversation_id selected
       FROM agent_conversations c JOIN agents a ON a.id = c.agent_id JOIN teams t ON t.id = a.team_id
       LEFT JOIN agent_conversation_selection s ON s.agent_id = c.agent_id
       WHERE (? IS NULL OR c.agent_id = ?)
       ORDER BY c.updated_at DESC`,
    )
    .all(options.agentId ?? null, options.agentId ?? null)
  const hits: ConversationSearchHit[] = []
  let unreadable = 0
  for (const row of rows) {
    await new Promise((resolve) => setImmediate(resolve))
    if (options.signal?.aborted) break
    const directory = join(paths.agentDir(row.agentId), 'sessions')
    let text: string
    try {
      text = readSessionText(directory, row.id)
    } catch {
      unreadable++
      continue
    }
    const lower = text.toLowerCase()
    if (!raw.every((word) => lower.includes(word))) continue
    // Every message, those a compaction summarized included: the conversation shows them all.
    let messages: ConversationHistory['messages']
    try {
      messages = conversationHistory(branchOf(parseSessionText(text, row.id))).messages
    } catch {
      unreadable++
      continue
    }
    let nth = 0
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const [shown] = piMessagesToProviderView([message], options.secrets ?? [])
      if (!shown) continue
      // A stored credential is never found nor shown, even in a message that holds it.
      const content = redactExactValues(
        shown.content.startsWith(INBOX_WAKE_PREFIX)
          ? shown.content.slice(INBOX_WAKE_PREFIX.length)
          : shown.content.startsWith(WAKE_PREFIX)
            ? shown.content.slice(WAKE_PREFIX.length)
            : shown.content,
        options.secrets ?? [],
      )
      // Matched as it reads, not in its Markdown: a word only in a link's address does not count,
      // so the snippet and the conversation on screen both show it.
      const found = plainText(content).toLowerCase()
      if (!words.every((word) => found.includes(word))) continue
      const at = (message as { timestamp?: unknown }).timestamp
      hits.push({
        agentId: row.agentId,
        agentName: row.agentName,
        teamId: row.teamId,
        teamName: row.teamName,
        archived: Boolean(row.archived),
        conversationId: row.id,
        conversationTitle: row.title,
        active: row.selected === row.id,
        role: message.role,
        at: typeof at === 'number' && Number.isFinite(at) ? at : null,
        snippet: snippetOf(content, words),
        nth: nth++,
      })
    }
  }
  hits.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  return { words, hits: hits.slice(0, limit), truncated: hits.length > limit, unreadable }
}
