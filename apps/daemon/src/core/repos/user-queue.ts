import { createHash, randomUUID } from 'node:crypto'
import type {
  Attachment,
  QueueAttachment,
  UserQueueControl,
  UserQueueItem,
  UserQueueListResponse,
  UserQueueStatus,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

export const QUEUE_LIMITS = Object.freeze({
  perAgent: 20,
  perHome: 100,
  attachments: 16,
  itemBytes: 25 * 1024 * 1024,
  homeBytes: 256 * 1024 * 1024,
  textBytes: 64 * 1024,
  receipts: 100_000,
  terminalMs: 7 * 24 * 60 * 60_000,
})
const openStates = "'pending','claimed','running','held','uncertain'"
const fields = `id, agent_id AS agentId, team_id AS teamId, conversation_id AS conversationId,
 source, attempt_id AS attemptId, revision, position, status, text, payload_retained AS payloadRetained,
 supersedes_id AS supersedesId, approval_id AS approvalId, diagnostic, created_at AS createdAt,
 updated_at AS updatedAt, started_at AS startedAt, finished_at AS finishedAt`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type RawItem = Omit<UserQueueItem, 'attachments' | 'payloadRetained'> & { payloadRetained: number }
export class QueueConflictError extends Error {
  readonly code = 'queue_conflict'
}
export class QueueCapacityError extends Error {
  readonly code = 'queue_capacity'
}
export interface QueueInput {
  id: string
  agentId: string
  teamId: string
  conversationId: string
  source: 'http' | 'telegram'
  attemptId: string
  /** Daemon-created transport/selection binding, never a client-selected authority object. */
  provenance: unknown
  message: string
  attachments: Attachment[]
}

function normalize(message: string, attachments: Attachment[]) {
  if (
    typeof message !== 'string' ||
    Buffer.byteLength(message) > QUEUE_LIMITS.textBytes ||
    message.includes('\0')
  )
    throw new Error('Invalid or oversized queue text')
  if (!Array.isArray(attachments) || attachments.length > QUEUE_LIMITS.attachments)
    throw new Error('Invalid queue attachments')
  let total = 0
  const files = attachments.map((file) => {
    if (
      !file ||
      typeof file.mimeType !== 'string' ||
      !/^[a-z0-9.!#$&^_+-]+\/[a-z0-9.!#$&^_+-]+$/i.test(file.mimeType) ||
      file.mimeType.length > 200 ||
      typeof file.data !== 'string'
    )
      throw new Error('Invalid queue attachment')
    if (
      file.name !== undefined &&
      (typeof file.name !== 'string' ||
        !file.name.length ||
        file.name.length > 255 ||
        [...file.name].some(
          (char) =>
            char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\',
        ))
    )
      throw new Error('Invalid attachment name')
    if (file.data.length > Math.ceil(QUEUE_LIMITS.itemBytes / 3) * 4)
      throw new QueueCapacityError('Queue attachment exceeds 25 MiB')
    const bytes = Buffer.from(file.data, 'base64')
    total += bytes.length
    if (total > QUEUE_LIMITS.itemBytes) throw new QueueCapacityError('Queue item exceeds 25 MiB')
    if (bytes.toString('base64') !== file.data) throw new Error('Invalid attachment bytes')
    return {
      name: file.name ?? null,
      mimeType: file.mimeType.toLowerCase(),
      bytes,
      byteLength: bytes.length,
      sha256: hash(bytes),
    }
  })
  if (!message.trim() && !files.length) throw new Error('Queue input is empty')
  return { message, files, total }
}

export function control(db: BazilionDb, agentId: string): UserQueueControl {
  const row = db.raw
    .query<{ paused: number; revision: number; reason: string | null }, [string]>(
      'SELECT paused, revision, reason FROM user_queue_controls WHERE agent_id = ?',
    )
    .get(agentId)
  return row ? { ...row, paused: row.paused === 1 } : { paused: false, revision: 0, reason: null }
}
function ensureControl(db: BazilionDb, agentId: string) {
  db.raw.run('INSERT INTO user_queue_controls (agent_id) VALUES (?) ON CONFLICT DO NOTHING', [
    agentId,
  ])
}
function attachments(db: BazilionDb, id: string): QueueAttachment[] {
  return db.raw
    .query<QueueAttachment, [string]>(
      `SELECT id, name, mime_type AS mimeType, byte_length AS byteLength, sha256 FROM user_queue_attachments WHERE item_id = ? ORDER BY ordinal`,
    )
    .all(id)
}
function hydrate(db: BazilionDb, row: RawItem): UserQueueItem {
  return {
    ...row,
    payloadRetained: row.payloadRetained === 1,
    attachments: attachments(db, row.id),
  }
}
export function get(db: BazilionDb, agentId: string, id: string): UserQueueItem | null {
  const row = db.raw
    .query<RawItem, [string, string]>(
      `SELECT ${fields} FROM user_queue_items WHERE agent_id = ? AND id = ?`,
    )
    .get(agentId, id)
  return row ? hydrate(db, row) : null
}
export function list(
  db: BazilionDb,
  agentId: string,
  options: { all?: boolean; limit?: number; offset?: number } = {},
): UserQueueListResponse {
  const { all = false, limit = 20, offset = 0 } = options
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error('Invalid queue pagination')
  const where = `agent_id = ?${all ? '' : ` AND status IN (${openStates})`}`
  const rows = db.raw
    .query<RawItem, [string, number, number]>(
      `SELECT ${fields} FROM user_queue_items WHERE ${where} ORDER BY position, created_at, id LIMIT ? OFFSET ?`,
    )
    .all(agentId, limit, offset)
  const total =
    db.raw
      .query<{ n: number }, [string]>(`SELECT count(*) n FROM user_queue_items WHERE ${where}`)
      .get(agentId)?.n ?? 0
  return {
    items: rows.map((row) => hydrate(db, row)),
    control: control(db, agentId),
    total,
    limit,
    offset,
  }
}
export function pendingCount(db: BazilionDb, agentId: string): number {
  return (
    db.raw
      .query<{ n: number }, [string]>(
        `SELECT count(*) n FROM user_queue_items WHERE agent_id = ? AND status IN (${openStates})`,
      )
      .get(agentId)?.n ?? 0
  )
}

/** Storage transaction only. The admission service owns authentication, selection and policy. */
export function accept(
  db: BazilionDb,
  input: QueueInput,
  replacement?: { id: string; expectedRevision: number },
): UserQueueItem {
  if (
    !uuid.test(input.id) ||
    !input.attemptId ||
    input.attemptId.length > 256 ||
    !['http', 'telegram'].includes(input.source)
  )
    throw new Error('Invalid queue identity')
  const normalized = normalize(input.message, input.attachments)
  const provenance = JSON.stringify(input.provenance)
  if (typeof provenance !== 'string' || Buffer.byteLength(provenance) > 16 * 1024)
    throw new Error('Invalid queue provenance')
  const digest = hash(
    JSON.stringify({
      agentId: input.agentId,
      teamId: input.teamId,
      conversationId: input.conversationId,
      source: input.source,
      provenance: input.provenance,
      message: normalized.message,
      files: normalized.files.map(({ bytes: _bytes, ...meta }) => meta),
      replaces: replacement?.id ?? null,
    }),
  )
  return db.raw.transaction(() => {
    const existing = db.raw
      .query<{ id: string; input_digest: string; agent_id: string }, [string, string]>(
        'SELECT id, input_digest, agent_id FROM user_queue_items WHERE source = ? AND attempt_id = ?',
      )
      .get(input.source, input.attemptId)
    if (existing) {
      if (existing.agent_id !== input.agentId || existing.input_digest !== digest)
        throw new QueueConflictError('Queue attempt identity was reused with different input')
      const receipt = get(db, input.agentId, existing.id)
      if (!receipt) throw new Error('Queue receipt unavailable')
      return receipt
    }
    ensureControl(db, input.agentId)
    let previous: UserQueueItem | null = null
    if (replacement) {
      previous = get(db, input.agentId, replacement.id)
      if (
        previous?.status !== 'pending' ||
        previous.revision !== replacement.expectedRevision ||
        input.source !== 'http' ||
        previous.conversationId !== input.conversationId ||
        previous.teamId !== input.teamId
      )
        throw new QueueConflictError(
          'Queue item changed or already started; keep the correction as a draft',
        )
    }
    const counts = db.raw
      .query<{ total: number; open: number; bytes: number }, []>(
        `SELECT (SELECT count(*) FROM user_queue_items) total, (SELECT count(*) FROM user_queue_items WHERE status IN (${openStates})) open, (SELECT coalesce(sum(byte_length),0) FROM user_queue_attachments) bytes`,
      )
      .get()
    if (
      !counts ||
      counts.total >= QUEUE_LIMITS.receipts ||
      counts.open - (previous ? 1 : 0) >= QUEUE_LIMITS.perHome ||
      pendingCount(db, input.agentId) - (previous ? 1 : 0) >= QUEUE_LIMITS.perAgent ||
      counts.bytes + normalized.total > QUEUE_LIMITS.homeBytes
    )
      throw new QueueCapacityError('Queue capacity reached; reconcile retained work first')
    const owner = db.raw
      .query<{ team_id: string }, [string]>('SELECT team_id FROM agents WHERE id = ?')
      .get(input.agentId)
    if (owner?.team_id !== input.teamId) throw new QueueConflictError('Agent membership changed')
    const now = Date.now()
    const position =
      previous?.position ??
      db.raw
        .query<{ next_position: number }, [string]>(
          'SELECT next_position FROM user_queue_controls WHERE agent_id = ?',
        )
        .get(input.agentId)?.next_position
    if (position === undefined) throw new Error('Queue control unavailable')
    if (previous) {
      db.raw.run(
        "UPDATE user_queue_items SET status = 'superseded', revision = revision + 1, updated_at = ?, finished_at = ? WHERE id = ?",
        [now, now, previous.id],
      )
    } else
      db.raw.run(
        'UPDATE user_queue_controls SET next_position = next_position + 1 WHERE agent_id = ?',
        [input.agentId],
      )
    db.raw.run(
      `INSERT INTO user_queue_items (id,agent_id,team_id,conversation_id,source,attempt_id,input_digest,provenance_json,position,status,text,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
      [
        input.id,
        input.agentId,
        input.teamId,
        input.conversationId,
        input.source,
        input.attemptId,
        digest,
        provenance,
        position,
        normalized.message,
        previous?.id ?? null,
        now,
        now,
      ],
    )
    normalized.files.forEach((file, ordinal) => {
      db.raw.run(
        `INSERT INTO user_queue_attachments (id,item_id,ordinal,name,mime_type,byte_length,sha256,bytes) VALUES (?,?,?,?,?,?,?,?)`,
        [
          randomUUID(),
          input.id,
          ordinal,
          file.name,
          file.mimeType,
          file.byteLength,
          file.sha256,
          file.bytes,
        ],
      )
    })
    const receipt = get(db, input.agentId, input.id)
    if (!receipt) throw new Error('Queue acceptance failed')
    return receipt
  })()
}

/** Validate retained bytes before any turn preparation. Never fall back to text alone. */
export function readInput(
  db: BazilionDb,
  agentId: string,
  id: string,
): { item: UserQueueItem; attachments: Attachment[]; provenance: unknown; digest: string } {
  const item = get(db, agentId, id)
  if (!item?.payloadRetained || item.text === null)
    throw new Error('Queue input no longer retained')
  const row = db.raw
    .query<{ provenance_json: string; input_digest: string }, [string]>(
      'SELECT provenance_json, input_digest FROM user_queue_items WHERE id = ?',
    )
    .get(id)
  if (!row) throw new Error('Queue input unavailable')
  const retainedSize = db.raw
    .query<{ n: number; bytes: number }, [string]>(
      'SELECT count(*) n, coalesce(sum(length(bytes)),0) bytes FROM user_queue_attachments WHERE item_id = ?',
    )
    .get(id)
  if (
    !retainedSize ||
    retainedSize.n > QUEUE_LIMITS.attachments ||
    retainedSize.bytes > QUEUE_LIMITS.itemBytes
  )
    throw new Error('Queue attachments exceed retained bounds')
  const files = db.raw
    .query<
      {
        id: string
        name: string | null
        mime_type: string
        byte_length: number
        sha256: string
        bytes: Uint8Array
      },
      [string]
    >('SELECT * FROM user_queue_attachments WHERE item_id = ? ORDER BY ordinal')
    .all(id)
  const restored = files.map((file) => {
    const bytes = Buffer.from(file.bytes)
    if (bytes.length !== file.byte_length || hash(bytes) !== file.sha256)
      throw new Error('Queue attachment is missing or corrupt')
    return {
      ...(file.name === null ? {} : { name: file.name }),
      mimeType: file.mime_type,
      data: bytes.toString('base64'),
    }
  })
  const normalized = normalize(item.text, restored)
  const provenance = JSON.parse(row.provenance_json)
  const actualDigest = hash(
    JSON.stringify({
      agentId: item.agentId,
      teamId: item.teamId,
      conversationId: item.conversationId,
      source: item.source,
      provenance,
      message: item.text,
      files: normalized.files.map(({ bytes: _bytes, ...meta }) => meta),
      replaces: item.supersedesId,
    }),
  )
  if (actualDigest !== row.input_digest)
    throw new Error('Queue input binding is missing or corrupt')
  return { item, attachments: restored, provenance, digest: row.input_digest }
}

export function setPaused(
  db: BazilionDb,
  agentId: string,
  paused: boolean,
  expectedRevision: number,
  reason: string | null = null,
): UserQueueControl {
  if (
    typeof paused !== 'boolean' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    (reason !== null && (typeof reason !== 'string' || reason.length > 500))
  )
    throw new Error('Invalid queue control')
  return db.raw.transaction(() => {
    ensureControl(db, agentId)
    if (
      !paused &&
      db.raw
        .query<{ n: number }, [string]>(
          "SELECT count(*) n FROM user_queue_items WHERE agent_id = ? AND status = 'uncertain'",
        )
        .get(agentId)?.n
    )
      throw new QueueConflictError('Reconcile uncertain work before resuming')
    const changed = db.raw.run(
      'UPDATE user_queue_controls SET paused = ?, revision = revision + 1, reason = ? WHERE agent_id = ? AND revision = ?',
      [paused ? 1 : 0, reason, agentId, expectedRevision],
    )
    if (Number(changed.changes) !== 1) throw new QueueConflictError('Queue controls changed')
    return control(db, agentId)
  })()
}
export function remove(
  db: BazilionDb,
  agentId: string,
  id: string,
  revision: number,
): UserQueueItem {
  const now = Date.now()
  const changed = db.raw.run(
    "UPDATE user_queue_items SET status = 'cancelled', revision = revision + 1, updated_at = ?, finished_at = ? WHERE id = ? AND agent_id = ? AND revision = ? AND status = 'pending'",
    [now, now, id, agentId, revision],
  )
  if (Number(changed.changes) !== 1)
    throw new QueueConflictError('Queue item changed or already started')
  const item = get(db, agentId, id)
  if (!item) throw new Error('Queue item unavailable')
  return item
}
export function claim(db: BazilionDb, agentId: string): UserQueueItem | null {
  return db.raw.transaction(() => {
    if (control(db, agentId).paused) return null
    const head = db.raw
      .query<RawItem, [string]>(
        `SELECT ${fields} FROM user_queue_items WHERE agent_id = ? AND status IN (${openStates}) ORDER BY position, created_at, id LIMIT 1`,
      )
      .get(agentId)
    if (head?.status !== 'pending') return null
    const now = Date.now()
    db.raw.run(
      "UPDATE user_queue_items SET status = 'claimed', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'pending'",
      [now, head.id],
    )
    return get(db, agentId, head.id)
  })()
}
export function transition(
  db: BazilionDb,
  agentId: string,
  id: string,
  from: UserQueueStatus,
  to: UserQueueStatus,
  options: { approvalId?: string; diagnostic?: string } = {},
): UserQueueItem {
  const permitted: Partial<Record<UserQueueStatus, UserQueueStatus[]>> = {
    pending: ['held', 'failed'],
    claimed: ['pending', 'running', 'held', 'failed', 'cancelled'],
    running: ['completed', 'failed', 'cancelled', 'uncertain'],
    held: ['claimed', 'running', 'failed', 'cancelled', 'uncertain'],
    uncertain: ['cancelled'],
  }
  if (!permitted[from]?.includes(to)) throw new QueueConflictError('Invalid queue transition')
  if (to === 'held' && !options.approvalId)
    throw new Error('Approval hold needs its canonical owner')
  return db.raw.transaction(() => {
    const now = Date.now()
    const terminal = ['completed', 'failed', 'cancelled', 'uncertain'].includes(to)
    const changed = db.raw.run(
      `UPDATE user_queue_items SET status = ?, revision = revision + 1, approval_id = coalesce(?,approval_id), diagnostic = ?, updated_at = ?, started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END, finished_at = CASE WHEN ? THEN ? ELSE finished_at END WHERE id = ? AND agent_id = ? AND status = ?`,
      [
        to,
        options.approvalId ?? null,
        options.diagnostic?.slice(0, 500) ?? null,
        now,
        to,
        now,
        terminal ? 1 : 0,
        now,
        id,
        agentId,
        from,
      ],
    )
    if (Number(changed.changes) !== 1) throw new QueueConflictError('Queue lifecycle changed')
    if (to === 'uncertain') {
      ensureControl(db, agentId)
      db.raw.run(
        "UPDATE user_queue_controls SET paused = 1, revision = revision + 1, reason = 'interrupted' WHERE agent_id = ?",
        [agentId],
      )
    }
    const item = get(db, agentId, id)
    if (!item) throw new Error('Queue item unavailable')
    return item
  })()
}
/** Called once per daemon bootstrap, before starting any drain. */
export function recoverInterrupted(db: BazilionDb): number {
  return db.raw.transaction(() => {
    const now = Date.now()
    // Include the crash window between the canonical approval claim and queue claim.
    const interrupted =
      "status IN ('claimed','running') OR (status = 'held' AND EXISTS (SELECT 1 FROM communication_approvals a WHERE a.id = user_queue_items.approval_id AND a.status = 'delivering'))"
    const agents = db.raw
      .query<{ agent_id: string }, []>(
        `SELECT DISTINCT agent_id FROM user_queue_items WHERE ${interrupted}`,
      )
      .all()
    for (const row of agents) {
      ensureControl(db, row.agent_id)
      db.raw.run(
        "UPDATE user_queue_controls SET paused = 1, revision = revision + 1, reason = 'interrupted' WHERE agent_id = ?",
        [row.agent_id],
      )
    }
    return Number(
      db.raw.run(
        `UPDATE user_queue_items SET status = 'uncertain', revision = revision + 1, diagnostic = 'Daemon restarted before outcome was recorded', finished_at = ?, updated_at = ? WHERE ${interrupted}`,
        [now, now],
      ).changes,
    )
  })()
}
/** Release terminal canonical holds without ever independently dispatching their input. */
export function reconcileApprovalHolds(db: BazilionDb): number {
  return db.raw.transaction(() => {
    const holds = db.raw
      .query<{ id: string; agent_id: string; status: string }, []>(
        `SELECT q.id, q.agent_id, a.status FROM user_queue_items q
       JOIN communication_approvals a ON a.id = q.approval_id
       WHERE q.status = 'held' AND a.status IN ('denied','expired','cancelled','delivered','delivery_failed')`,
      )
      .all()
    for (const hold of holds) {
      const uncertain = hold.status === 'delivered' || hold.status === 'delivery_failed'
      transition(db, hold.agent_id, hold.id, 'held', uncertain ? 'uncertain' : 'cancelled', {
        diagnostic: uncertain
          ? 'Approval finished without a recorded queue outcome'
          : `Communication approval ${hold.status}`,
      })
    }
    return holds.length
  })()
}

export function pruneTerminalInput(db: BazilionDb, now = Date.now()): number {
  return db.raw.transaction(() => {
    const rows = db.raw
      .query<{ id: string }, [number]>(
        "SELECT id FROM user_queue_items WHERE payload_retained = 1 AND status IN ('completed','failed','cancelled','superseded') AND finished_at <= ? AND NOT EXISTS (SELECT 1 FROM communication_approvals a WHERE a.id = user_queue_items.approval_id AND a.status IN ('pending','approved','delivering'))",
      )
      .all(now - QUEUE_LIMITS.terminalMs)
    for (const { id } of rows) {
      db.raw.run('DELETE FROM user_queue_attachments WHERE item_id = ?', [id])
      db.raw.run(
        'UPDATE user_queue_items SET text = NULL, provenance_json = NULL, payload_retained = 0 WHERE id = ?',
        [id],
      )
    }
    return rows.length
  })()
}

/** Internal reconciliation lookup; callers authenticate before reading an attempt. */
export function findAttempt(
  db: BazilionDb,
  source: 'http' | 'telegram',
  attemptId: string,
): UserQueueItem | null {
  const row = db.raw
    .query<RawItem, [string, string]>(
      `SELECT ${fields} FROM user_queue_items WHERE source = ? AND attempt_id = ?`,
    )
    .get(source, attemptId)
  return row ? hydrate(db, row) : null
}
export function agentsWithOpenItems(db: BazilionDb): string[] {
  return db.raw
    .query<{ agent_id: string }, []>(
      `SELECT DISTINCT agent_id FROM user_queue_items WHERE status IN (${openStates})`,
    )
    .all()
    .map((row) => row.agent_id)
}

export function validateInput(message: string, attachments: Attachment[]): void {
  normalize(message, attachments)
}

/** Metadata-only authority read, including when retained attachment integrity fails. */
export function readProvenance(db: BazilionDb, agentId: string, id: string): unknown {
  const row = db.raw
    .query<{ provenance_json: string }, [string, string]>(
      'SELECT provenance_json FROM user_queue_items WHERE agent_id = ? AND id = ? AND length(provenance_json) <= 16384',
    )
    .get(agentId, id)
  if (!row?.provenance_json) throw new Error('Queue provenance unavailable')
  return JSON.parse(row.provenance_json)
}
export function approvalReference(
  db: BazilionDb,
  agentId: string,
  id: string,
): { agentId: string; itemId: string; inputDigest: string } {
  const row = db.raw
    .query<{ input_digest: string }, [string, string]>(
      'SELECT input_digest FROM user_queue_items WHERE id = ? AND agent_id = ?',
    )
    .get(id, agentId)
  if (!row) throw new QueueConflictError('Queue approval input unavailable')
  return { agentId, itemId: id, inputDigest: row.input_digest }
}
