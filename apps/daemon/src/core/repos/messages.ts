import { randomUUID } from 'node:crypto'
import type { Message } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

interface RawMessage {
  id: string
  from_agent_id: string
  to_agent_id: string
  reply_to: string | null
  payload: string
  created_at: number
  read_at: number | null
}

function toMessage(r: RawMessage): Message {
  return {
    id: r.id,
    fromAgentId: r.from_agent_id,
    toAgentId: r.to_agent_id,
    replyTo: r.reply_to,
    payload: r.payload,
    createdAt: r.created_at,
    readAt: r.read_at,
  }
}

export function send(
  db: BazilionDb,
  input: { from: string; to: string; payload: string; replyTo?: string | null },
): Message {
  const id = randomUUID()
  const now = Date.now()
  db.raw.run(
    `INSERT INTO messages (id, from_agent_id, to_agent_id, reply_to, payload, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [id, input.from, input.to, input.replyTo ?? null, input.payload, now],
  )
  return {
    id,
    fromAgentId: input.from,
    toAgentId: input.to,
    replyTo: input.replyTo ?? null,
    payload: input.payload,
    createdAt: now,
    readAt: null,
  }
}

export function get(db: BazilionDb, id: string): Message | null {
  const row = db.raw.query<RawMessage, [string]>('SELECT * FROM messages WHERE id = ?').get(id)
  return row ? toMessage(row) : null
}

export function listInbox(
  db: BazilionDb,
  agentId: string,
  opts?: { unreadOnly?: boolean },
): Message[] {
  const sql = opts?.unreadOnly
    ? 'SELECT * FROM messages WHERE to_agent_id = ? AND read_at IS NULL ORDER BY created_at ASC'
    : 'SELECT * FROM messages WHERE to_agent_id = ? ORDER BY created_at ASC'
  return db.raw.query<RawMessage, [string]>(sql).all(agentId).map(toMessage)
}

export function markRead(db: BazilionDb, id: string): void {
  db.raw.run('UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL', [Date.now(), id])
}

/**
 * Find messages that are replies to a given message id, addressed to a specific agent.
 * Used by `wait_for_reply` to poll for incoming responses.
 */
export function findReplies(db: BazilionDb, toAgentId: string, inReplyTo: string): Message[] {
  return db.raw
    .query<RawMessage, [string, string]>(
      `SELECT * FROM messages
       WHERE to_agent_id = ? AND reply_to = ?
       ORDER BY created_at ASC`,
    )
    .all(toAgentId, inReplyTo)
    .map(toMessage)
}

/**
 * Return the distinct `to_agent_id`s that currently have at least one unread
 * message, filtered to agents not in a terminal state (idle or starting).
 * Used by the scheduler's message-wake loop so a tick can fan-out auto-
 * delivery turns without walking every agent in the DB.
 */
export function listRecipientsWithUnread(db: BazilionDb): string[] {
  const rows = db.raw
    .query<{ to_agent_id: string }, []>(
      `SELECT DISTINCT m.to_agent_id FROM messages m
       JOIN agents a ON a.id = m.to_agent_id
       WHERE m.read_at IS NULL AND a.status = 'idle'
       ORDER BY m.to_agent_id`,
    )
    .all()
  return rows.map((r) => r.to_agent_id)
}

/**
 * Atomically fetch + mark-read all unread messages addressed to `agentId`.
 * Runs inside a transaction so two concurrent schedulers / manual deliveries
 * can't double-dispatch the same message. Returns the fetched messages in
 * ascending `created_at` order — callers format them into the recipient's
 * wake-up prompt.
 */
export function drainUnreadForAgent(db: BazilionDb, agentId: string): Message[] {
  return db.raw.transaction(() => {
    const rows = db.raw
      .query<RawMessage, [string]>(
        `SELECT * FROM messages
         WHERE to_agent_id = ? AND read_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all(agentId)
    if (rows.length === 0) return []
    const now = Date.now()
    db.raw.run(
      `UPDATE messages SET read_at = ?
       WHERE to_agent_id = ? AND read_at IS NULL`,
      [now, agentId],
    )
    return rows.map((r) => toMessage({ ...r, read_at: now }))
  })()
}
