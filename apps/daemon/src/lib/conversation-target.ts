import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Conversation, ConversationTarget } from '@bazilion/api-types'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { resolveAgent } from '../core/agent/resolve.ts'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import * as conversations from '../core/repos/conversations.ts'
import { readSessionHeader } from '../runtime/pi/session-file.ts'

function sessionsDir(paths: Paths, agentId: string): string {
  return join(paths.agentDir(agentId), 'sessions')
}

/** Start a new, empty conversation for the Agent and select it. Old ones stay in the library. */
export function startConversation(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  title?: string,
): Conversation {
  const agent = resolveAgent(db, paths, agentId)
  // A refused title must not leave a session file behind.
  if (title !== undefined) conversations.validTitle(title)
  const id = randomUUID()
  const header = SessionManager.inMemory(agent.team.path, { id }).getHeader()
  writeFileSync(join(sessionsDir(paths, agentId), `${id}.jsonl`), `${JSON.stringify(header)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  return conversations.create(db, agentId, id, title)
}

/**
 * The conversation a turn writes to: the given one (a queued follow-up keeps the conversation it
 * was sent to), else the selected one, else a new one. Its transcript must exist.
 */
export function resolveConversationTarget(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
  pinnedId?: string,
): ConversationTarget {
  const id =
    pinnedId ?? conversations.selectedId(db, agentId) ?? startConversation(db, paths, agentId).id
  if (!conversations.get(db, agentId, id)) throw new Error('Conversation not found')
  readSessionHeader(sessionsDir(paths, agentId), id)
  return { id }
}

/** The selected conversation without creating one. */
export function selectedConversationTarget(
  db: BazilionDb,
  agentId: string,
): ConversationTarget | null {
  const id = conversations.selectedId(db, agentId)
  return id ? { id } : null
}
