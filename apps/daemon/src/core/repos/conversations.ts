import type { Conversation, ConversationListResponse } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'

// Conversation metadata. The transcript itself is Pi's session file `<id>.jsonl`.

const columns = 'id, agent_id AS agentId, title, created_at AS createdAt, updated_at AS updatedAt'

/** A truncate aimed at one conversation while the Agent has since switched to another. */
export class ConversationChangedError extends DomainError {
  constructor() {
    super(409, 'The Agent switched to another conversation. Reload before trying again.')
  }
}

/** The Agent's selected conversation, the one new turns write to; null before its first turn. */
export function selectedId(db: BazilionDb, agentId: string): string | null {
  return (
    db.raw
      .query<{ id: string }, [string]>(
        'SELECT conversation_id AS id FROM agent_conversation_selection WHERE agent_id = ?',
      )
      .get(agentId)?.id ?? null
  )
}

export function get(db: BazilionDb, agentId: string, id: string): Conversation | null {
  return db.raw
    .query<Conversation, [string, string]>(
      `SELECT ${columns} FROM agent_conversations WHERE agent_id = ? AND id = ?`,
    )
    .get(agentId, id)
}

export function list(
  db: BazilionDb,
  agentId: string,
  limit = 20,
  offset = 0,
): ConversationListResponse {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new DomainError(400, 'Invalid conversation pagination')
  const conversations = db.raw
    .query<Conversation, [string, number, number]>(
      `SELECT ${columns} FROM agent_conversations WHERE agent_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
    )
    .all(agentId, limit, offset)
  const total =
    db.raw
      .query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM agent_conversations WHERE agent_id = ?',
      )
      .get(agentId)?.n ?? 0
  return { conversations, selectedId: selectedId(db, agentId), total, offset, limit }
}

/** A conversation title, trimmed: 1–200 characters without control characters. */
export function validTitle(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new DomainError(
      400,
      'Conversation title must be 1–200 characters without control characters',
    )
  return value.trim()
}

/** Record a new conversation whose session file already exists, and select it. */
export function create(db: BazilionDb, agentId: string, id: string, title?: string): Conversation {
  const displayTitle = title === undefined ? undefined : validTitle(title)
  return db.raw.transaction(() => {
    const now = Date.now()
    db.raw.run(
      `INSERT INTO agent_conversations (id, agent_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`,
      [id, agentId, displayTitle ?? `Conversation ${list(db, agentId, 1).total + 1}`, now, now],
    )
    db.raw.run(
      `INSERT INTO agent_conversation_selection (agent_id, conversation_id) VALUES (?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET conversation_id = excluded.conversation_id`,
      [agentId, id],
    )
    const conversation = get(db, agentId, id)
    if (!conversation) throw new Error('Conversation not found')
    return conversation
  })()
}

export function rename(db: BazilionDb, agentId: string, id: string, title: string): Conversation {
  db.raw.run(
    'UPDATE agent_conversations SET title = ?, updated_at = ? WHERE agent_id = ? AND id = ?',
    [validTitle(title), Date.now(), agentId, id],
  )
  const conversation = get(db, agentId, id)
  if (!conversation) throw new DomainError(404, 'Conversation not found')
  return conversation
}
