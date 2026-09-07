import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationTarget } from '@bazilion/api-types'
import { SessionManager } from '@earendil-works/pi-coding-agent'

export function seedConversationTarget(directory: string, cwd: string): ConversationTarget {
  mkdirSync(directory, { recursive: true })
  const id = randomUUID()
  const filename = `${id}.jsonl`
  const header = SessionManager.inMemory(cwd, { id }).getHeader()
  writeFileSync(join(directory, filename), `${JSON.stringify(header)}\n`, { mode: 0o600 })
  return { id, filename }
}

import type { BazilionDb } from '../../src/core/db/client.ts'
import type { Paths } from '../../src/core/paths.ts'
import * as conversations from '../../src/core/repos/conversations.ts'

export function seedRegisteredConversation(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
): ConversationTarget {
  const existing = conversations.selection(db, agentId)
  if (existing.conversationId)
    return {
      id: existing.conversationId,
      filename: conversations.filename(db, agentId, existing.conversationId),
    }
  const target = seedConversationTarget(join(paths.agentDir(agentId), 'sessions'), paths.home)
  conversations.create(
    db,
    agentId,
    { requestId: target.id, expectedSelection: existing },
    () => target.filename,
  )
  return target
}
