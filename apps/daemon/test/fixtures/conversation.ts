import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationTarget, ResolvedAgent } from '@bazilion/api-types'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { BazilionDb } from '../../src/core/db/client.ts'
import type { Paths } from '../../src/core/paths.ts'
import * as conversations from '../../src/core/repos/conversations.ts'

export function seedConversationTarget(directory: string, cwd: string): ConversationTarget {
  mkdirSync(directory, { recursive: true })
  const id = randomUUID()
  const header = SessionManager.inMemory(cwd, { id }).getHeader()
  writeFileSync(join(directory, `${id}.jsonl`), `${JSON.stringify(header)}\n`, { mode: 0o600 })
  return { id }
}

export function seedRegisteredConversation(
  db: BazilionDb,
  paths: Paths,
  agentId: string,
): ConversationTarget {
  const existing = conversations.selectedId(db, agentId)
  if (existing) return { id: existing }
  const target = seedConversationTarget(join(paths.agentDir(agentId), 'sessions'), paths.home)
  conversations.create(db, agentId, target.id)
  return target
}

/**
 * Append synthetic user/assistant messages to an Agent's existing conversation file through
 * Pi's own SessionManager, so reads round-trip through the real JSONL format.
 */
export function seedSessionMessages(
  agent: ResolvedAgent,
  paths: Paths,
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  conversation: ConversationTarget,
): void {
  const cwd = agent.team.path
  mkdirSync(cwd, { recursive: true })
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  const file = join(sessionDir, `${conversation.id}.jsonl`)
  if (!existsSync(file)) throw new Error(`conversation file ${file} does not exist`)
  const sm = SessionManager.open(file, sessionDir, cwd)
  const now = Date.now()
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      sm.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: m.text }],
        timestamp: now + i,
      })
    } else {
      sm.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: m.text }],
        api: 'openai-completions',
        provider: 'lmstudio',
        model: 'test-model',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now + i,
      })
    }
  })
}

/** Count message entries on the current branch of a conversation file; 0 when there is none. */
export function countSessionMessages(
  agent: ResolvedAgent,
  paths: Paths,
  conversation: ConversationTarget | null | undefined,
): number {
  if (!conversation) return 0
  const sessionDir = join(paths.agentDir(agent.agent.id), 'sessions')
  const file = join(sessionDir, `${conversation.id}.jsonl`)
  if (!existsSync(file)) return 0
  try {
    const sm = SessionManager.open(file, sessionDir, agent.team.path)
    // Conversation messages; Pi's own system-prompt entries are not part of the chat.
    return sm.getBranch().filter((e) => e.type === 'message' && e.message.role !== 'system').length
  } catch {
    return 0
  }
}
