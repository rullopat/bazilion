import { createHash, randomUUID } from 'node:crypto'
import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

export const MAX_RESULT_BYTES = 25 * 1024 * 1024
export const MAX_RETAINED_RESULT_BYTES = 1024 * 1024 * 1024

const columns = `id, team_id AS teamId, agent_id AS agentId, session_id AS sessionId,
  tool_call_id AS toolCallId, name, mime_type AS mimeType, byte_length AS byteLength,
  sha256, created_at AS createdAt, released_at AS releasedAt, deleted_at AS deletedAt`

export interface PublishResultInput {
  teamId: string
  agentId: string
  sessionId: string
  toolCallId: string
  name: string
  mimeType: string
  bytes: Uint8Array
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)
}

/** Internal receipt lookup. Never expose this function as an operator read. */
export function getReceipt(db: BazilionDb, id: string): AgentResult | null {
  return db.raw
    .query<AgentResult, [string]>(`SELECT ${columns} FROM agent_results WHERE id = ?`)
    .get(id)
}

/** Publication does not release a result. The existing egress authorizer owns release. */
export function publish(db: BazilionDb, input: PublishResultInput): AgentResult {
  if (
    !validIdentity(input.teamId) ||
    !validIdentity(input.agentId) ||
    !validIdentity(input.sessionId) ||
    !validIdentity(input.toolCallId)
  )
    throw new Error('Invalid result provenance')
  if (
    typeof input.name !== 'string' ||
    !input.name ||
    input.name.length > 255 ||
    /[/\\]/.test(input.name) ||
    [...input.name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    input.name === '.' ||
    input.name === '..'
  )
    throw new Error('Invalid result filename')
  if (typeof input.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(input.mimeType)) {
    throw new Error('Invalid result media type')
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_RESULT_BYTES) {
    throw new Error('Result exceeds the 25 MiB per-file limit')
  }
  const bytes = Buffer.from(input.bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return db.raw.transaction(() => {
    const existing = db.raw
      .query<AgentResult, [string, string, string]>(
        `SELECT ${columns} FROM agent_results WHERE agent_id = ? AND session_id = ? AND tool_call_id = ?`,
      )
      .get(input.agentId, input.sessionId, input.toolCallId)
    if (existing) {
      if (existing.deletedAt !== null) throw new Error('Captured result was deleted')
      if (
        existing.teamId !== input.teamId ||
        existing.sha256 !== sha256 ||
        existing.name !== input.name ||
        existing.mimeType !== input.mimeType
      ) {
        throw new Error('Result publication retry does not match the captured operation')
      }
      return existing
    }
    const owner = db.raw
      .query<{ team_id: string }, [string]>('SELECT team_id FROM agents WHERE id = ?')
      .get(input.agentId)
    if (owner?.team_id !== input.teamId)
      throw new Error('Result producer is not a member of the Team')
    const retained =
      db.raw
        .query<{ bytes: number }, []>(
          'SELECT coalesce(sum(byte_length), 0) AS bytes FROM agent_results WHERE deleted_at IS NULL',
        )
        .get()?.bytes ?? 0
    if (retained + bytes.byteLength > MAX_RETAINED_RESULT_BYTES) {
      throw new Error(
        'Result storage is full (1 GiB). Delete saved results before delivering more files.',
      )
    }
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO agent_results
      (id, team_id, agent_id, session_id, tool_call_id, name, mime_type, byte_length, sha256, created_at, bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.teamId,
        input.agentId,
        input.sessionId,
        input.toolCallId,
        input.name,
        input.mimeType,
        bytes.byteLength,
        sha256,
        Date.now(),
        bytes,
      ],
    )
    const result = getReceipt(db, id)
    if (!result) throw new Error('Result publication failed')
    return result
  })()
}

/** Call only after the source-owned egress authorization or approval succeeds. */
export function release(db: BazilionDb, id: string, agentId: string): void {
  const result = db.raw.run(
    `UPDATE agent_results SET released_at = coalesce(released_at, ?)
    WHERE id = ? AND agent_id = ? AND deleted_at IS NULL
      AND (released_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM agents a WHERE a.id = agent_results.agent_id AND a.team_id = agent_results.team_id
      ))`,
    [Date.now(), id, agentId],
  )
  if (result.changes !== 1) throw new Error('Captured result is unavailable')
}

export function getReleased(db: BazilionDb, id: string): AgentResult | null {
  const result = getReceipt(db, id)
  return result && result.releasedAt !== null ? result : null
}

export function listReleased(
  db: BazilionDb,
  opts: { teamId?: string; agentId?: string; limit?: number; offset?: number } = {},
): ResultListResponse {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)))
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  if (!Number.isFinite(limit) || !Number.isSafeInteger(offset))
    throw new Error('Invalid pagination')
  const where = ['released_at IS NOT NULL', 'deleted_at IS NULL']
  const params: string[] = []
  if (opts.teamId !== undefined) {
    where.push('team_id = ?')
    params.push(opts.teamId)
  }
  if (opts.agentId !== undefined) {
    where.push('agent_id = ?')
    params.push(opts.agentId)
  }
  const filter = where.join(' AND ')
  const total =
    db.raw
      .query<{ total: number }, string[]>(
        `SELECT count(*) AS total FROM agent_results WHERE ${filter}`,
      )
      .get(...params)?.total ?? 0
  const results = db.raw
    .query<AgentResult, (string | number)[]>(
      `SELECT ${columns} FROM agent_results WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
  return { results, total, limit, offset }
}

/** Internal captured-byte read, also used by the authorized approval dispatcher. */
export function readCaptured(db: BazilionDb, id: string): Buffer {
  const row = db.raw
    .query<{ bytes: Uint8Array; byte_length: number; sha256: string }, [string]>(
      'SELECT bytes, byte_length, sha256 FROM agent_results WHERE id = ? AND deleted_at IS NULL',
    )
    .get(id)
  if (!row) throw new Error('Captured result is unavailable')
  const bytes = Buffer.from(row.bytes)
  if (
    bytes.byteLength !== row.byte_length ||
    createHash('sha256').update(bytes).digest('hex') !== row.sha256
  ) {
    throw new Error('Captured result failed integrity verification')
  }
  return bytes
}

export function readReleased(db: BazilionDb, id: string): Buffer {
  if (!getReleased(db, id)) throw new Error('Result not found')
  return readCaptured(db, id)
}

export function deleteReleased(db: BazilionDb, id: string): boolean {
  return (
    db.raw.run(
      `UPDATE agent_results SET bytes = NULL, deleted_at = coalesce(deleted_at, ?)
    WHERE id = ? AND released_at IS NOT NULL`,
      [Date.now(), id],
    ).changes === 1
  )
}
