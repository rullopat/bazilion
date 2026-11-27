// `recall` with `everywhere`: the turn's Agent searches its other conversations, every message of
// them, and reads one by its id. Only the Agent's own conversations; stored credentials are taken
// out as `recall` does for the conversation it is in.

import { join } from 'node:path'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import { branchOf } from '../runtime/pi/history.ts'
import { parseSessionText, readSessionText } from '../runtime/pi/session-file.ts'
import { numberedMessages, read, recallHits, recallWords } from '../runtime/tools/recall.ts'
import type { RecallHost } from '../runtime/worker/ipc-protocol.ts'

/** The most hits listed for one conversation, and in all: the latest ones. Shapes output only. */
const HITS_PER_CONVERSATION = 4
const HITS_IN_ALL = 12

interface Row {
  id: string
  title: string
  updatedAt: number
}

export function createRecallHost(options: {
  db: BazilionDb
  paths: Paths
  agentId: string
  /** The conversation the turn is in: `recall` reads its own summarized part itself. */
  conversationId: string
  secrets: readonly string[]
}): RecallHost {
  const { db, paths, agentId } = options
  const directory = join(paths.agentDir(agentId), 'sessions')
  const others = (): Row[] =>
    db.raw
      .query<Row, [string, string]>(
        `SELECT id, title, updated_at AS updatedAt FROM agent_conversations
         WHERE agent_id = ? AND id != ? ORDER BY updated_at DESC, id`,
      )
      .all(agentId, options.conversationId)
  const messagesOf = (id: string) =>
    numberedMessages(
      branchOf(parseSessionText(readSessionText(directory, id), id)),
      options.secrets,
    )

  return {
    async search(query) {
      const words = recallWords(query)
      // In the raw JSON a word reads as JSON writes it.
      const raw = words.map((word) => JSON.stringify(word).slice(1, -1))
      const lines: string[] = []
      let listed = 0
      let found = 0
      let conversations = 0
      for (const row of others()) {
        let text: string
        try {
          text = readSessionText(directory, row.id)
        } catch {
          continue
        }
        const lower = text.toLowerCase()
        if (!raw.every((word) => lower.includes(word))) continue
        let hits: ReturnType<typeof recallHits>
        try {
          hits = recallHits(messagesOf(row.id), words)
        } catch {
          continue
        }
        if (hits.length === 0) continue
        found += hits.length
        conversations++
        if (listed >= HITS_IN_ALL) continue
        const shown = hits.slice(-Math.min(HITS_PER_CONVERSATION, HITS_IN_ALL - listed))
        listed += shown.length
        lines.push(
          `Conversation "${row.title}" (id ${row.id}, last changed ${new Date(row.updatedAt).toISOString().slice(0, 10)}): ${hits.length} ${hits.length === 1 ? 'message holds' : 'messages hold'} every word`,
          ...shown.map((hit) => `  ${hit.heading}: ${hit.snippet}`),
        )
      }
      if (found === 0) return `None of your other conversations holds every word of "${query}".`
      return [
        ...lines,
        ...(listed < found
          ? [
              `${found - listed} more in ${conversations} conversations are not listed: add a word to narrow it.`,
            ]
          : []),
        'Read one in full with `conversation` and `from`.',
      ].join('\n')
    },
    async read(conversationId, from, count) {
      if (!others().some((row) => row.id === conversationId)) {
        throw new Error(
          conversationId === options.conversationId
            ? 'recall: that is this conversation; read its summarized part with `from` alone'
            : 'recall: you have no other conversation with that id',
        )
      }
      return read(messagesOf(conversationId), from, count, 'messages')
    },
  }
}
