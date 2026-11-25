// A conversation as people read it: every message of its branch, those a compaction summarized
// included, with where each compaction happened. The model's view (Pi's buildSessionContext)
// keeps only the latest summary and what follows it; the session file keeps everything.

import type { CompactionMark, ContextUse } from '@bazilion/api-types'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  calculateContextTokens,
  type FileEntry,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent'

export interface ConversationHistory {
  /** The branch's messages, oldest first; Pi's system-prompt entries are not among them. */
  messages: AgentMessage[]
  compactions: CompactionMark[]
}

/** The entries from the first to the leaf (the last entry), the path Pi builds a context from. */
export function branchOf(entries: readonly FileEntry[]): SessionEntry[] {
  const all = entries.filter((entry): entry is SessionEntry => entry.type !== 'session')
  const byId = new Map(all.map((entry) => [entry.id, entry]))
  const path: SessionEntry[] = []
  const seen = new Set<string>()
  for (let entry = all.at(-1); entry && !seen.has(entry.id); ) {
    seen.add(entry.id)
    path.push(entry)
    entry = entry.parentId ? byId.get(entry.parentId) : undefined
  }
  return path.reverse()
}

/**
 * The branch's messages and compactions. Messages are the ones the truncate route counts (every
 * message entry but the system prompt's), so a position here is a position there.
 */
export function conversationHistory(branch: readonly SessionEntry[]): ConversationHistory {
  const messages: AgentMessage[] = []
  const position = new Map<string, number>()
  const compactions: CompactionMark[] = []
  for (const entry of branch) {
    position.set(entry.id, messages.length)
    if (entry.type === 'message' && entry.message.role !== 'system') {
      const message = entry.message
      // Session files are read without validation; a message without content still counts.
      messages.push(
        'content' in message && message.content == null ? { ...message, content: [] } : message,
      )
    } else if (entry.type === 'compaction') {
      compactions.push({
        // The part kept verbatim starts at firstKeptEntryId; the summary stands for what precedes.
        index: position.get(entry.firstKeptEntryId) ?? messages.length,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        at: Date.parse(entry.timestamp) || 0,
      })
    }
  }
  return { messages, compactions }
}

/**
 * How full the window is: what the model reported reading for its last reply after the latest
 * compaction (null when it has not replied since), and the window it was given.
 */
export function contextUse(branch: readonly SessionEntry[], window: number | null): ContextUse {
  const latestCompaction = branch.findLastIndex((entry) => entry.type === 'compaction')
  for (let i = branch.length - 1; i > latestCompaction; i--) {
    const entry = branch[i]
    if (entry?.type !== 'message' || entry.message.role !== 'assistant') continue
    if (entry.message.stopReason === 'aborted' || entry.message.stopReason === 'error') continue
    const tokens = calculateContextTokens(entry.message.usage)
    if (tokens > 0) return { tokens, window }
  }
  return { tokens: null, window }
}
