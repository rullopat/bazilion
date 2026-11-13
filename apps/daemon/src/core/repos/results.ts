import { createHash, randomUUID } from 'node:crypto'
import type { AgentResult, ResultListResponse } from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { isToolCallId } from '../tool-call-id.ts'

// Agent results: files an Agent delivered (deliver_file) or generated (image_generate), kept in
// the database so they survive the workspace and the Agent.

export const MAX_RESULT_BYTES = 25 * 1024 * 1024
export const MAX_RETAINED_RESULT_BYTES = 1024 * 1024 * 1024

const columns = `id, team_id AS teamId, agent_id AS agentId, session_id AS sessionId,
  tool_call_id AS toolCallId, source_index AS sourceIndex, name, mime_type AS mimeType,
  byte_length AS byteLength, sha256, image_model AS imageModel, created_at AS createdAt`

export interface PublishResultInput {
  teamId: string
  agentId: string
  /** The conversation and tool call that produced the file. */
  sessionId: string
  toolCallId: string
  /** Position of an image among those one image_generate call returned; 0 otherwise. */
  sourceIndex?: number
  name: string
  mimeType: string
  bytes: Uint8Array
  imageModel?: string
}

export function get(db: BazilionDb, id: string): AgentResult | null {
  return db.raw
    .query<AgentResult, [string]>(`SELECT ${columns} FROM agent_results WHERE id = ?`)
    .get(id)
}

/** Save a file. Publishing the same tool call's file again returns the saved one. */
export function publish(db: BazilionDb, input: PublishResultInput): AgentResult {
  if (!isToolCallId(input.toolCallId)) throw new Error('Invalid result tool call')
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
  if (typeof input.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(input.mimeType))
    throw new Error('Invalid result media type')
  if (input.bytes.byteLength > MAX_RESULT_BYTES)
    throw new Error('Result exceeds the 25 MiB per-file limit')
  const bytes = Buffer.from(input.bytes)
  const sourceIndex = input.sourceIndex ?? 0
  return db.raw.transaction(() => {
    const existing = db.raw
      .query<{ id: string }, [string, string, string, number]>(
        `SELECT id FROM agent_results
         WHERE agent_id = ? AND session_id = ? AND tool_call_id = ? AND source_index = ?`,
      )
      .get(input.agentId, input.sessionId, input.toolCallId, sourceIndex)
    if (existing) return get(db, existing.id) as AgentResult
    const retained =
      db.raw
        .query<{ bytes: number }, []>(
          'SELECT coalesce(sum(byte_length), 0) AS bytes FROM agent_results',
        )
        .get()?.bytes ?? 0
    if (retained + bytes.byteLength > MAX_RETAINED_RESULT_BYTES)
      throw new Error(
        'Result storage is full (1 GiB). Delete saved results before delivering more files.',
      )
    const id = randomUUID()
    db.raw.run(
      `INSERT INTO agent_results
      (id, team_id, agent_id, session_id, tool_call_id, source_index, name, mime_type,
       byte_length, sha256, image_model, created_at, bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.teamId,
        input.agentId,
        input.sessionId,
        input.toolCallId,
        sourceIndex,
        input.name,
        input.mimeType,
        bytes.byteLength,
        createHash('sha256').update(bytes).digest('hex'),
        input.imageModel ?? null,
        Date.now(),
        bytes,
      ],
    )
    return get(db, id) as AgentResult
  })()
}

export function list(
  db: BazilionDb,
  opts: { teamId?: string; agentId?: string; limit?: number; offset?: number } = {},
): ResultListResponse {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 50)))
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const where: string[] = []
  const params: string[] = []
  if (opts.teamId !== undefined) {
    where.push('team_id = ?')
    params.push(opts.teamId)
  }
  if (opts.agentId !== undefined) {
    where.push('agent_id = ?')
    params.push(opts.agentId)
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total =
    db.raw
      .query<{ total: number }, string[]>(`SELECT count(*) AS total FROM agent_results ${filter}`)
      .get(...params)?.total ?? 0
  const results = db.raw
    .query<AgentResult, (string | number)[]>(
      `SELECT ${columns} FROM agent_results ${filter} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
  return { results, total, limit, offset }
}

/** A saved file's bytes, checked against the digest recorded when it was saved. */
export function read(db: BazilionDb, id: string): Buffer {
  const row = db.raw
    .query<{ bytes: Uint8Array; sha256: string }, [string]>(
      'SELECT bytes, sha256 FROM agent_results WHERE id = ?',
    )
    .get(id)
  if (!row) throw new Error('Result not found')
  const bytes = Buffer.from(row.bytes)
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
    throw new Error('Saved file failed its integrity check')
  return bytes
}

export function remove(db: BazilionDb, id: string): boolean {
  return db.raw.run('DELETE FROM agent_results WHERE id = ?', [id]).changes === 1
}
