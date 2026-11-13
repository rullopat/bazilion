import { randomUUID } from 'node:crypto'
import type {
  Attachment,
  UserQueueItem,
  UserQueueListResponse,
  UserQueueStatus,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'

// The follow-up queue: input that reaches a busy Agent waits here and runs after the current turn,
// oldest first, one at a time per Agent. A pending item can be edited or removed; a paused queue
// starts nothing. Finished items are kept for a week.

export const QUEUE_LIMITS = Object.freeze({
  /** Waiting or running items per Agent. */
  perAgent: 20,
  attachments: 16,
  itemBytes: 25 * 1024 * 1024,
  /** Attachment bytes across all retained items. */
  homeBytes: 256 * 1024 * 1024,
  textBytes: 64 * 1024,
  keepMs: 7 * 24 * 60 * 60_000,
})

export class QueueInputError extends DomainError {
  constructor(message: string) {
    super(400, message)
  }
}
export class QueueConflictError extends DomainError {
  constructor(message: string) {
    super(409, message)
  }
}
export class QueueCapacityError extends DomainError {
  constructor(message: string) {
    super(429, message)
  }
}

const fields = `id, agent_id AS agentId, conversation_id AS conversationId, source, status, text,
  diagnostic, created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt,
  finished_at AS finishedAt`
type Row = Omit<UserQueueItem, 'attachments'>

export interface QueueInput {
  agentId: string
  conversationId: string
  message: string
  attachments: Attachment[]
  /** A Telegram message: its chat:message key (so a redelivered update is queued once) and origin. */
  telegram?: { key: string; origin: unknown }
}

/** A claimed item with everything its turn needs. */
export interface ClaimedItem {
  item: UserQueueItem
  attachments: Attachment[]
  /** The Telegram message it came from, as recorded when it was queued. */
  origin: unknown
}

/** Check text and attachments; returns the attachments' decoded size. Emptiness is checked apart. */
export function validateInput(message: string, attachments: Attachment[]): number {
  if (typeof message !== 'string') throw new QueueInputError('message must be a string')
  if (Buffer.byteLength(message) > QUEUE_LIMITS.textBytes)
    throw new QueueInputError('Follow-up text must be at most 64 KiB')
  if (message.includes('\0')) throw new QueueInputError('Follow-up text must not contain NUL')
  if (!Array.isArray(attachments)) throw new QueueInputError('attachments must be an array')
  if (attachments.length > QUEUE_LIMITS.attachments)
    throw new QueueInputError('A follow-up can carry at most 16 attachments')
  let total = 0
  for (const file of attachments) {
    if (
      !file ||
      typeof file.mimeType !== 'string' ||
      !/^[a-z0-9.!#$&^_+-]+\/[a-z0-9.!#$&^_+-]+$/i.test(file.mimeType) ||
      typeof file.data !== 'string' ||
      (file.name !== undefined &&
        (typeof file.name !== 'string' || !file.name || file.name.length > 255))
    )
      throw new QueueInputError('Invalid follow-up attachment')
    total += Buffer.byteLength(file.data, 'base64')
  }
  if (total > QUEUE_LIMITS.itemBytes)
    throw new QueueCapacityError('Follow-up attachments exceed 25 MiB')
  return total
}

export function isPaused(db: BazilionDb, agentId: string): boolean {
  return (
    db.raw
      .query<{ paused: number }, [string]>(
        'SELECT paused FROM user_queue_controls WHERE agent_id = ?',
      )
      .get(agentId)?.paused === 1
  )
}

export function setPaused(db: BazilionDb, agentId: string, paused: boolean): void {
  db.raw.run(
    `INSERT INTO user_queue_controls (agent_id, paused) VALUES (?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET paused = excluded.paused`,
    [agentId, paused ? 1 : 0],
  )
}

function hydrate(db: BazilionDb, row: Row): UserQueueItem {
  const attachments = db.raw
    .query<{ name: string | null; mimeType: string; byteLength: number }, [string]>(
      `SELECT name, mime_type AS mimeType, length(bytes) AS byteLength
      FROM user_queue_attachments WHERE item_id = ? ORDER BY ordinal`,
    )
    .all(row.id)
  return { ...row, attachments }
}

export function get(db: BazilionDb, agentId: string, id: string): UserQueueItem | null {
  const row = db.raw
    .query<Row, [string, string]>(
      `SELECT ${fields} FROM user_queue_items WHERE agent_id = ? AND id = ?`,
    )
    .get(agentId, id)
  return row ? hydrate(db, row) : null
}

/** Waiting, running and failed items, oldest first. */
export function list(db: BazilionDb, agentId: string): Omit<UserQueueListResponse, 'turnActive'> {
  const rows = db.raw
    .query<Row, [string]>(
      `SELECT ${fields} FROM user_queue_items
      WHERE agent_id = ? AND status IN ('pending','running','failed')
      ORDER BY created_at, rowid`,
    )
    .all(agentId)
  return { paused: isPaused(db, agentId), items: rows.map((row) => hydrate(db, row)) }
}

export function pendingCount(db: BazilionDb, agentId: string): number {
  return (
    db.raw
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM user_queue_items WHERE agent_id = ? AND status = 'pending'",
      )
      .get(agentId)?.n ?? 0
  )
}

function insertAttachments(db: BazilionDb, id: string, attachments: Attachment[]): void {
  attachments.forEach((file, ordinal) => {
    db.raw.run(
      'INSERT INTO user_queue_attachments (item_id, ordinal, name, mime_type, bytes) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        ordinal,
        file.name ?? null,
        file.mimeType.toLowerCase(),
        Buffer.from(file.data, 'base64'),
      ],
    )
  })
}

function assertHomeBytes(db: BazilionDb, adding: number): void {
  const stored =
    db.raw
      .query<{ bytes: number }, []>(
        'SELECT coalesce(sum(length(bytes)), 0) AS bytes FROM user_queue_attachments',
      )
      .get()?.bytes ?? 0
  if (stored + adding > QUEUE_LIMITS.homeBytes)
    throw new QueueCapacityError('Follow-up storage is full; remove queued items first')
}

/** Queue input at the end of the Agent's queue. A Telegram message already queued is returned. */
export function add(db: BazilionDb, input: QueueInput): UserQueueItem {
  const bytes = validateInput(input.message, input.attachments)
  if (!input.message.trim() && !input.attachments.length)
    throw new QueueInputError('Follow-up is empty')
  return db.raw.transaction(() => {
    if (input.telegram) {
      const existing = db.raw
        .query<{ id: string }, [string]>(
          'SELECT id FROM user_queue_items WHERE telegram_message = ?',
        )
        .get(input.telegram.key)
      if (existing) return get(db, input.agentId, existing.id) as UserQueueItem
    }
    const open =
      db.raw
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM user_queue_items WHERE agent_id = ? AND status IN ('pending','running')",
        )
        .get(input.agentId)?.n ?? 0
    if (open >= QUEUE_LIMITS.perAgent)
      throw new QueueCapacityError('The queue is full (20 follow-ups); wait or remove some')
    assertHomeBytes(db, bytes)
    const id = randomUUID()
    const now = Date.now()
    db.raw.run(
      `INSERT INTO user_queue_items (id, agent_id, conversation_id, source, telegram_message,
        origin_json, status, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        input.agentId,
        input.conversationId,
        input.telegram ? 'telegram' : 'http',
        input.telegram?.key ?? null,
        input.telegram ? JSON.stringify(input.telegram.origin) : null,
        input.message,
        now,
        now,
      ],
    )
    insertAttachments(db, id, input.attachments)
    return get(db, input.agentId, id) as UserQueueItem
  })()
}

/** Replace a waiting item's text; its attachments stay. */
export function edit(db: BazilionDb, agentId: string, id: string, message: string): UserQueueItem {
  validateInput(message, [])
  return db.raw.transaction(() => {
    const changed = db.raw.run(
      "UPDATE user_queue_items SET text = ?, updated_at = ? WHERE agent_id = ? AND id = ? AND status = 'pending'",
      [message, Date.now(), agentId, id],
    )
    if (changed.changes !== 1)
      throw new QueueConflictError('Only a waiting follow-up can be edited')
    const item = get(db, agentId, id) as UserQueueItem
    if (!item.text.trim() && !item.attachments.length)
      throw new QueueInputError('Follow-up is empty')
    return item
  })()
}

/** Delete an item that is not running; returns it with its Telegram origin. */
export function remove(
  db: BazilionDb,
  agentId: string,
  id: string,
): { item: UserQueueItem; origin: unknown } {
  return db.raw.transaction(() => {
    const item = get(db, agentId, id)
    if (!item) throw new QueueConflictError('Follow-up not found')
    if (item.status === 'running')
      throw new QueueConflictError('This follow-up is running; stop the turn instead')
    const origin = telegramOrigin(db, id)
    db.raw.run('DELETE FROM user_queue_items WHERE id = ?', [id])
    return { item, origin }
  })()
}

/** The Telegram message an item came from, or null. */
export function telegramOrigin(db: BazilionDb, id: string): unknown {
  const row = db.raw
    .query<{ origin: string | null }, [string]>(
      'SELECT origin_json AS origin FROM user_queue_items WHERE id = ?',
    )
    .get(id)
  return row?.origin ? JSON.parse(row.origin) : null
}

/** Mark the oldest waiting item running, unless the queue is paused or an item already runs. */
export function claim(db: BazilionDb, agentId: string): ClaimedItem | null {
  return db.raw.transaction(() => {
    if (isPaused(db, agentId)) return null
    const head = db.raw
      .query<{ id: string; status: UserQueueStatus }, [string]>(
        `SELECT id, status FROM user_queue_items WHERE agent_id = ? AND status IN ('pending','running')
        ORDER BY status = 'pending', created_at, rowid LIMIT 1`,
      )
      .get(agentId)
    if (head?.status !== 'pending') return null
    const now = Date.now()
    db.raw.run(
      "UPDATE user_queue_items SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?",
      [now, now, head.id],
    )
    const attachments = db.raw
      .query<{ name: string | null; mimeType: string; bytes: Uint8Array }, [string]>(
        `SELECT name, mime_type AS mimeType, bytes FROM user_queue_attachments
        WHERE item_id = ? ORDER BY ordinal`,
      )
      .all(head.id)
      .map((file) => ({
        ...(file.name === null ? {} : { name: file.name }),
        mimeType: file.mimeType,
        data: Buffer.from(file.bytes).toString('base64'),
      }))
    return {
      item: get(db, agentId, head.id) as UserQueueItem,
      attachments,
      origin: telegramOrigin(db, head.id),
    }
  })()
}

/** Put a claimed item back at the head: its turn could not start because the Agent was busy. */
export function unclaim(db: BazilionDb, id: string): void {
  db.raw.run(
    "UPDATE user_queue_items SET status = 'pending', started_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
    [Date.now(), id],
  )
}

export function finish(
  db: BazilionDb,
  agentId: string,
  id: string,
  status: 'completed' | 'failed' | 'cancelled',
  diagnostic: string | null = null,
): UserQueueItem | null {
  const now = Date.now()
  db.raw.run(
    `UPDATE user_queue_items SET status = ?, diagnostic = ?, finished_at = ?, updated_at = ?
    WHERE agent_id = ? AND id = ? AND status = 'running'`,
    [status, diagnostic?.slice(0, 500) ?? null, now, now, agentId, id],
  )
  return get(db, agentId, id)
}

export const INTERRUPTED_BY_RESTART = 'Interrupted by a daemon restart; not run again'

/** At startup: items left running were interrupted. Fail them and pause their queues. */
export function recoverInterrupted(db: BazilionDb): number {
  return db.raw.transaction(() => {
    const now = Date.now()
    for (const { agentId } of db.raw
      .query<{ agentId: string }, []>(
        "SELECT DISTINCT agent_id AS agentId FROM user_queue_items WHERE status = 'running'",
      )
      .all())
      setPaused(db, agentId, true)
    return Number(
      db.raw.run(
        `UPDATE user_queue_items SET status = 'failed', diagnostic = ?, finished_at = ?, updated_at = ?
        WHERE status = 'running'`,
        [INTERRUPTED_BY_RESTART, now, now],
      ).changes,
    )
  })()
}

/** Delete items that finished more than a week ago. */
export function prune(db: BazilionDb, now = Date.now()): number {
  return Number(
    db.raw.run(
      "DELETE FROM user_queue_items WHERE status IN ('completed','failed','cancelled') AND finished_at <= ?",
      [now - QUEUE_LIMITS.keepMs],
    ).changes,
  )
}

/** Agents, not archived, whose queue has a waiting item and is not paused. */
export function agentsWithPending(db: BazilionDb): string[] {
  return db.raw
    .query<{ agentId: string }, []>(
      `SELECT DISTINCT i.agent_id AS agentId FROM user_queue_items i
      JOIN agents a ON a.id = i.agent_id AND a.status <> 'archived'
      LEFT JOIN user_queue_controls c ON c.agent_id = i.agent_id
      WHERE i.status = 'pending' AND coalesce(c.paused, 0) = 0`,
    )
    .all()
    .map((row) => row.agentId)
}
