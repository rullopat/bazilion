import { randomUUID } from 'node:crypto'
import type { ConversationTarget } from '@bazilion/api-types'
import { resolveAgent } from '../core/agent/resolve.ts'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import * as conversations from '../core/repos/conversations.ts'
import { createConversationFile } from './conversation-file.ts'
import { readResultSession } from './result-source.ts'

/** Called under the Agent lifecycle lease. Explicit delayed targets never change selection. */
export function resolveConversationTarget(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  pinnedId?: string,
): ConversationTarget {
  let id = pinnedId ?? conversations.selection(db, agentId).conversationId
  if (!id) {
    const agent = resolveAgent(db, paths, agentId)
    id = conversations.create(
      db,
      agentId,
      {
        requestId: randomUUID(),
        expectedSelection: { conversationId: null, revision: 0 },
      },
      (newId) => createConversationFile(paths, agentId, newId, agent.team.path),
    ).conversation.id
  }
  const filename = conversations.filename(db, agentId, id)
  readResultSession(paths, agentId, filename, id)
  return { id, filename }
}

/** Read routing metadata without creating a conversation or changing selection. */
export function selectedConversationTarget(
  db: BazilionDb,
  agentId: string,
): ConversationTarget | null {
  const id = conversations.selection(db, agentId).conversationId
  return id ? { id, filename: conversations.filename(db, agentId, id) } : null
}
