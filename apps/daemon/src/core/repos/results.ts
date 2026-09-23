import { createHash, randomUUID } from 'node:crypto'
import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

export const MAX_RESULT_BYTES = 25 * 1024 * 1024
export const MAX_RETAINED_RESULT_BYTES = 1024 * 1024 * 1024

const columns = `id, team_id AS teamId, agent_id AS agentId, source_kind AS sourceKind,
  session_id AS sessionId, tool_call_id AS toolCallId, review_packet_id AS reviewPacketId,
  review_revision AS reviewRevision, name, mime_type AS mimeType, byte_length AS byteLength,
  sha256, created_at AS createdAt, released_at AS releasedAt, deleted_at AS deletedAt,
  source_index AS sourceIndex, image_model AS imageModel`

/**
 * What produced a result: a turn's `deliver_file` call, or an artifact a daemon surface produced from a
 * review packet.
 *
 * The source is inferred from which identity is supplied rather than stated twice, and the database checks
 * that exactly one pair is present — so neither kind can be published under the other's identity. Existing
 * turn publishers are unchanged: naming a session and tool call *is* the turn source.
 */
export interface PublishResultInput {
  teamId: string
  agentId: string
  name: string
  mimeType: string
  bytes: Uint8Array
  /** A turn's tool call: the source unless a review packet is named instead. */
  sessionId?: string
  toolCallId?: string
  /** Image blocks share their real canonical tool call; never synthesize transcript identities. */
  sourceIndex?: number
  imageModel?: string
  /** A review export: the packet and the revision it describes. */
  reviewPacketId?: string
  reviewRevision?: string
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
  if (!validIdentity(input.teamId) || !validIdentity(input.agentId)) {
    throw new Error('Invalid result provenance')
  }
  // Exactly one source, checked here as well as by the table's paired constraints: a result whose
  // provenance is ambiguous would be one whose access rules nobody can reason about.
  const source = input.reviewPacketId !== undefined ? 'review_packet' : 'session_tool'
  if (source === 'session_tool') {
    if (!validIdentity(input.sessionId) || !validIdentity(input.toolCallId)) {
      throw new Error('Invalid result provenance')
    }
    if (input.reviewRevision !== undefined) throw new Error('Invalid result provenance')
  } else if (
    !validIdentity(input.reviewPacketId) ||
    !validIdentity(input.reviewRevision) ||
    input.sessionId !== undefined ||
    input.toolCallId !== undefined
  ) {
    throw new Error('Invalid result provenance')
  }
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
  const sourceIndex = input.sourceIndex ?? 0
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 3) {
    throw new Error('Invalid result source index')
  }
  const bytes = Buffer.from(input.bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return db.raw.transaction(() => {
    // Retry idempotency is keyed on the source: the same tool call, or the same export of the same
    // revision of the same packet.
    const existing =
      source === 'session_tool'
        ? db.raw
            .query<AgentResult, [string, string, string, number]>(
              `SELECT ${columns} FROM agent_results
               WHERE agent_id = ? AND source_kind = 'session_tool' AND session_id = ? AND tool_call_id = ? AND source_index = ?`,
            )
            // Narrowed by the validation above; the assertion is what the strings are.
            .get(input.agentId, input.sessionId as string, input.toolCallId as string, sourceIndex)
        : db.raw
            .query<AgentResult, [string, string, string]>(
              `SELECT ${columns} FROM agent_results
               WHERE agent_id = ? AND source_kind = 'review_packet' AND review_packet_id = ?
                 AND review_revision = ?`,
            )
            .get(input.agentId, input.reviewPacketId as string, input.reviewRevision as string)
    if (existing) {
      if (existing.deletedAt !== null) throw new Error('Captured result was deleted')
      if (
        existing.teamId !== input.teamId ||
        existing.sha256 !== sha256 ||
        existing.name !== input.name ||
        existing.mimeType !== input.mimeType ||
        existing.imageModel !== (input.imageModel ?? null)
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
      (id, team_id, agent_id, source_kind, session_id, tool_call_id, review_packet_id, review_revision,
       name, mime_type, byte_length, sha256, created_at, bytes, source_index, image_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.teamId,
        input.agentId,
        source,
        source === 'session_tool' ? input.sessionId : null,
        source === 'session_tool' ? input.toolCallId : null,
        source === 'review_packet' ? input.reviewPacketId : null,
        source === 'review_packet' ? input.reviewRevision : null,
        input.name,
        input.mimeType,
        bytes.byteLength,
        sha256,
        Date.now(),
        bytes,
        sourceIndex,
        input.imageModel ?? null,
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
